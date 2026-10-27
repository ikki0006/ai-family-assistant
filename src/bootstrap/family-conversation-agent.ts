import { DurableObject } from "cloudflare:workers";
import { Lifecycle } from "agents/lifecycle";
import { Sessions } from "agents/sessions";
import { answerWithSearch } from "../application/conversation/answer-with-search";
import { buildContext, contextSize } from "../application/conversation/build-context";
import type { ConversationMessage } from "../application/conversation/conversation";
import { isBareUrl, messageUrls } from "../application/conversation/message-url";
import {
	explicitReminderRequest,
	reminderCandidate,
} from "../application/conversation/participation";
import { isQuestionReply, readLink } from "../application/conversation/read-link";
import { receiveConversation } from "../application/conversation/receive-conversation";
import { parseReplyChoices } from "../application/conversation/reply-choices";
import {
	type IncomingText,
	createRespondToMention,
} from "../application/conversation/respond-to-mention";
import { scheduleContext } from "../application/conversation/schedule-context";
import { consultSource } from "../application/improvements/consult-source";
import { handleImprovement } from "../application/improvements/handle-improvement";
import { manageLists } from "../application/lists/manage-lists";
import {
	memoryCommand,
	memoryInventory,
	relevantMemories,
	scheduleInventory,
} from "../application/memory/memory-commands";
import { organizeMemory } from "../application/memory/organize-memory";
import { analyzePhoto } from "../application/photos/analyze-photo";
import type { GenerationJob } from "../application/ports/generation-queue";
import type { Improvement } from "../application/ports/improvement-repository";
import type { LongTermMemory } from "../application/ports/long-term-memory";
import type { MemoryJob } from "../application/ports/long-term-memory";
import type { QuickReply } from "../application/ports/quick-reply";
import type { ReminderJob } from "../application/ports/reminder-repository";
import type { ReplySender } from "../application/ports/reply-sender";
import { AiUsageLimitError } from "../application/ports/text-generator";
import { manageProfile, parseProfileCommand } from "../application/profiles/manage-profile";
import { followupContextPrompt } from "../application/prompts/links";
import { participationPrompt, reminderPlannerPrompt } from "../application/prompts/reminders";
import { taskPlannerPrompt } from "../application/prompts/tasks";
import { deliverReminder } from "../application/reminders/deliver-reminder";
import { manageReminders, parseReminderAction } from "../application/reminders/manage-reminders";
import type { ReminderAction } from "../application/reminders/manage-reminders";
import { deliverTasks } from "../application/tasks/deliver-tasks";
import { manageTasks } from "../application/tasks/manage-tasks";
import { createGeminiTextGenerator } from "../infrastructure/ai/gemini-text-generator";
import { createImprovementDispatcher } from "../infrastructure/github/improvement-dispatcher";
import { createSourceRepository } from "../infrastructure/github/source-repository";
import { createLineAnswerSender } from "../infrastructure/line/answer-sender";
import { createLineImageReader } from "../infrastructure/line/image-content";
import { createLinePushSender } from "../infrastructure/line/push-sender";
import { createLineReplySender } from "../infrastructure/line/reply-sender";
import { PendingQuestions } from "../infrastructure/memory/pending-questions";
import { PhotoReferences } from "../infrastructure/memory/photo-references";
import { QuickReplies } from "../infrastructure/memory/quick-replies";
import { SessionConversationStore } from "../infrastructure/memory/session-conversation-store";
import { diagnostics } from "../infrastructure/observability/diagnostics";
import { createFamilyLists, familyListsReady } from "../infrastructure/persistence/d1/family-lists";
import { createFamilyProfiles } from "../infrastructure/persistence/d1/family-profiles";
import { createFamilyTasks, familyTasksReady } from "../infrastructure/persistence/d1/family-tasks";
import { createGarbageScheduleStore } from "../infrastructure/persistence/d1/garbage-schedule";
import { createImprovementRepository } from "../infrastructure/persistence/d1/improvement-repository";
import { createLongTermMemory } from "../infrastructure/persistence/d1/long-term-memory";
import { createReminderRepository } from "../infrastructure/persistence/d1/reminders";
import { createGenerationQueue } from "../infrastructure/queue/generation-queue";
import { reserveSearch } from "../infrastructure/search/search-quota";
import { createTavilyPageReader } from "../infrastructure/search/tavily-page-reader";
import { createTavilyWebSearch } from "../infrastructure/search/tavily-web-search";
import type { Bindings } from "./create-app";

interface OperationContext {
	job: GenerationJob;
	owner: string;
	tasksReady: boolean;
	listsReady: boolean;
	taskVersion: number;
	listVersion: number;
	proactive: boolean;
}
type OperationOutcome =
	| { text: string; choices: string[]; buttons: QuickReply[] | undefined }
	| { skip: true };

export class FamilyConversationAgent extends DurableObject<Bindings> {
	readonly sessions = new Sessions();
	readonly lifecycle = Lifecycle.install(this).use(this.sessions);
	private readonly store = new SessionConversationStore(this.ctx.storage.sql, this.sessions);
	private readonly quickReplies = new QuickReplies(this.ctx.storage.sql);
	private readonly questions = new PendingQuestions(this.ctx.storage.sql);
	private readonly photos = new PhotoReferences(this.ctx.storage.sql);
	private organizing = false;
	private serial: Promise<unknown> = Promise.resolve();
	private locked<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.serial.then(fn, fn);
		this.serial = next.catch(() => {});
		return next;
	}
	private generator(timeoutMs = 120_000) {
		if (!this.env.AI || !this.env.AI_GATEWAY_ID) throw new Error("Missing AI configuration");
		return createGeminiTextGenerator(this.env.AI, this.env.AI_GATEWAY_ID, diagnostics, timeoutMs);
	}
	private improvementButtons(request: Improvement): QuickReply[] {
		return this.quickReplies.issue(
			[true, false].map((approve) => ({
				label: approve ? "承認してPR作成" : "キャンセル",
				choice: { kind: "improvement" as const, id: request.id, version: request.version, approve },
			})),
			null,
			Date.now(),
			24 * 3600000,
		);
	}
	async receive(inbound: IncomingText): Promise<void> {
		let message = inbound;
		const group = this.env.LINE_ALLOWED_GROUP_ID?.trim();
		if (!group || message.groupId !== group || message.chatType !== "group") return;
		if (message.unsend && message.messageId)
			await this.locked(async () => this.photos.forget(message.messageId ?? ""));
		if (message.image) {
			if (!message.messageId || !message.eventId || message.occurredAt === undefined) return;
			await this.locked(async () => {
				const now = Date.now();
				this.photos.record(message.messageId ?? "", message.occurredAt ?? now, now);
				if (!this.photos.request(message.eventId ?? "", message.messageId ?? "", now)) return;
				await this.ctx.storage.setAlarm(now + 3600000);
				await createGenerationQueue(this.env.JOBS_QUEUE).enqueue({
					eventId: message.eventId ?? "",
					groupId: group,
					imageId: message.messageId ?? "",
					text: "",
					replyToken: message.replyToken,
					receivedAt: now,
				});
			});
			return;
		}

		if (message.postback) {
			const choice = await this.locked(async () =>
				this.quickReplies.consume(message.postback ?? "", message.speaker, Date.now()),
			);
			if (!choice || (choice.kind === "improvement" && !this.env.DB)) {
				await createLineReplySender(
					this.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
					fetch,
					diagnostics,
				).reply(
					message.replyToken,
					"この選択は期限切れ・処理済み、または別の人への質問です。もう一度話しかけてください。",
				);
				return;
			}
			if (choice.kind === "task_complete") {
				const text = await this.locked(async () => {
					if (choice.owner !== message.speaker)
						return "この完了ボタンは別の担当者の分です。自分のボタンを選んでください。";
					if (!this.env.DB || !(await familyTasksReady(this.env.DB)))
						return "タスク機能は準備中です。";
					return manageTasks(
						createFamilyTasks(this.env.DB),
						group,
						message.eventId ?? "",
						{ op: "complete", id: choice.taskId, occurrenceId: choice.occurrenceId },
						choice.owner,
						[],
						Date.now(),
					);
				});
				await createLineReplySender(
					this.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
					fetch,
					diagnostics,
				).reply(message.replyToken, text);
				return;
			}
			if (choice.kind === "improvement" && !choice.approve && this.env.DB) {
				const cancelled = await createImprovementRepository(this.env.DB).cancel(
					group,
					choice.id,
					choice.version,
				);
				await createLineReplySender(
					this.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
					fetch,
					diagnostics,
				).reply(
					message.replyToken,
					cancelled ? "改善依頼をキャンセルしました。" : "この依頼はすでに処理されています。",
				);
				return;
			}
			if (choice.kind === "collection_delete") {
				const response = await this.locked(async () =>
					choice.approve && this.env.DB
						? (
								await manageLists(
									createFamilyLists(this.env.DB),
									group,
									message.eventId ?? "",
									{ op: "delete", listId: choice.listId },
									choice.version,
									true,
								)
							).text
						: "リストの削除をキャンセルしました。",
				);
				await createLineReplySender(
					this.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
					fetch,
					diagnostics,
				).reply(message.replyToken, response);
				return;
			}
			message = {
				...message,
				mentioned: true,
				text:
					choice.kind === "improvement"
						? `改善承認 ${choice.id} ${choice.version}`
						: `「${choice.question}」への回答: ${choice.text}`,
			};
		}
		if (message.mentioned && !message.unsend && /^改善承認(?:\s|$)/.test(message.text.trim())) {
			await this.ctx.storage.setAlarm(Date.now() + 3600000);
			let response = "自動改善の設定がまだ完了していません。";
			let buttons: QuickReply[] | undefined;
			if (this.env.DB && this.env.GH_IMPROVEMENT_TOKEN && message.eventId) {
				try {
					response =
						(await handleImprovement(
							{
								text: message.text,
								groupId: group,
								eventId: message.eventId,
							},
							{
								repository: createImprovementRepository(this.env.DB),
								onProposal: (request) => {
									buttons = this.improvementButtons(request);
								},
								dispatcher: createImprovementDispatcher(this.env.GH_IMPROVEMENT_TOKEN),
							},
						)) ?? "改善内容をもう一度送って、確認ボタンを選んでください。";
				} catch {
					response = "改善依頼の処理に失敗しました。GitHubの実行状況を確認してください。";
				}
			}
			await createLineReplySender(
				this.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
				fetch,
				diagnostics,
			).reply(message.replyToken, response, buttons);
			return;
		}
		await this.locked(async () => {
			const now = Date.now();
			const incoming = this.prepareIncoming(message, now);
			await this.ctx.storage.setAlarm(Date.now() + 3600000);
			await this.flushMemoryDeletions(group);
			const sender = createLineReplySender(
				this.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
				fetch,
				diagnostics,
				async (id, text) => {
					this.store.recordOutgoing(id, text, Date.now());
				},
			);
			const respond = createRespondToMention(
				sender,
				group,
				this.env.AI && this.env.AI_GATEWAY_ID ? this.generator() : undefined,
				diagnostics,
				createGenerationQueue(this.env.JOBS_QUEUE),
			);
			if (await this.handleProfileCommand(incoming, group, now, sender)) return;
			if (await this.handleMemoryCommand(incoming, group, now, sender)) return;
			await receiveConversation(this.store, group, respond, sender)(incoming);
			await this.flushMemoryDeletions(group);
		});
	}
	async answer(job: GenerationJob): Promise<void> {
		if (job.imageId) {
			await this.answerPhoto(job);
			return;
		}

		if (job.groupId !== this.env.LINE_ALLOWED_GROUP_ID?.trim() || !job.memory) return;
		const reference = job.memory;
		const snapshot = await this.locked(async () => {
			await this.flushMemoryDeletions(job.groupId);
			return this.store.snapshot(reference, Date.now());
		});
		if (!snapshot) return;
		const sender = createLineAnswerSender(
			this.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
			job,
			fetch,
			diagnostics,
			Date.now,
			async (id, text) => {
				this.store.recordOutgoing(id, text, Date.now());
			},
		);
		let answer = "";
		let choices: string[] = [];
		let operation: ReminderAction | undefined;
		let generated = false;
		let inspectSchedules = false;
		let listVersion = 0;
		let listsReady = false;
		let tasksReady = false;
		let taskVersion = 0;
		const latest = snapshot.messages.at(-1)?.text ?? "";
		const proactive = job.passive === true && !explicitReminderRequest(latest);
		const owner = snapshot.messages.at(-1)?.speaker ?? "unknown";
		const followup = job.followupId
			? this.questions.get(owner, job.followupId, Date.now())
			: undefined;
		if (
			job.followupId &&
			(!followup ||
				!(await isQuestionReply(
					followup.text,
					latest,
					this.generator(10_000),
					JSON.stringify(
						snapshot.messages
							.slice(0, -1)
							.filter((m) => m.occurredAt >= followup.created)
							.slice(-6)
							.map((m) => ({ role: m.role, speaker: m.speaker, text: m.text.slice(0, 500) })),
					),
				)))
		)
			return;
		const hasLink = messageUrls(latest).length > 0;
		try {
			const deadline = Date.now() + 120_000;
			if (hasLink) {
				const result = await readLink(
					latest,
					JSON.stringify({
						question: followup?.text,
						history: snapshot.messages
							.slice(-6)
							.map((m) => ({ role: m.role, text: m.text.slice(0, 1000) })),
					}),
					this.env.TAVILY_API_KEY?.trim()
						? createTavilyPageReader(this.env.TAVILY_API_KEY.trim())
						: undefined,
					this.generator(30_000),
					async () => this.locked(async () => reserveSearch(this.ctx.storage.sql, Date.now())),
					diagnostics,
				);
				answer = result.text;
				choices = result.choices;
				generated = true;
			}
			const profiles = this.env.DB ? await createFamilyProfiles(this.env.DB).list(job.groupId) : [];
			const profileContext = profiles.map(({ speaker, names, pending, version }) => ({
				speaker,
				names,
				pending,
				version,
			}));
			if (this.env.DB && !hasLink) {
				tasksReady = await familyTasksReady(this.env.DB);
				const taskState = tasksReady
					? await createFamilyTasks(this.env.DB).load(job.groupId)
					: { version: 0, tasks: [] };
				taskVersion = taskState.version;
				const existing = await createReminderRepository(this.env.DB).list(job.groupId);
				listsReady = await familyListsReady(this.env.DB);
				const listState = listsReady
					? await createFamilyLists(this.env.DB).load(job.groupId)
					: { version: 0, lists: [] };
				listVersion = listState.version;
				const quoted = job.quotedMessageId
					? this.store.outgoing(job.quotedMessageId, Date.now())
					: undefined;
				const plan = await this.generator(30_000).generate({
					system:
						reminderPlannerPrompt + participationPrompt + followupContextPrompt + taskPlannerPrompt,
					messages: [
						{
							role: "user",
							content: JSON.stringify({
								now: new Date(Date.now() + 9 * 3600000).toISOString().replace("Z", "+09:00"),
								profiles: profileContext,
								tasksAvailable: tasksReady,
								tasks: taskState.tasks.map((t) => ({
									...t,
									occurrences: t.occurrences.filter((o) => o.doneAt === null).slice(0, 50),
								})),
								collectionsAvailable: listsReady,
								collections: listState.lists.map((l) => ({
									id: l.id,
									name: l.name,
									aliases: l.aliases,
									items: l.items.map((i) => ({ id: i.id, text: i.text })),
								})),
								speaker: snapshot.messages.at(-1)?.speaker,
								passive: job.passive === true,
								latest,
								quoted,
								followupQuestion: followup?.text,
								history: snapshot.messages
									.slice(-6)
									.map((m) => ({ role: m.role, speaker: m.speaker, text: m.text.slice(0, 1000) })),
								existing: existing.map((r) => ({
									id: r.id,
									version: r.version,
									title: r.title,
									kind: r.kind,
									interval: r.interval ?? 1,
									day: r.day ?? undefined,
									month: r.month ?? undefined,
									at: new Date(r.next_at + 9 * 3600000).toISOString().replace("Z", "+09:00"),
									status: r.status,
								})),
							}),
						},
					],
				});
				operation = parseReminderAction(plan);
				if (
					job.passive &&
					["improve", "inspect_code", "collection", "task"].includes(operation.action)
				)
					return;
				operation = await this.consultOperation(operation, latest, snapshot.messages, deadline);
				if (operation.action === "inspect") {
					inspectSchedules = !job.passive;
					operation = { action: "none" };
				}
				if (proactive && !["none", "clarify"].includes(operation.action))
					operation = {
						action: "clarify",
						question:
							"その予定、リマインドを登録しますか？何をするための通知かと、希望の通知日時を教えてください。",
					};
				if (operation.action === "none") operation = undefined;
				if (job.passive && !operation) return;
				if (
					proactive &&
					operation?.action === "clarify" &&
					Date.now() - this.store.participation().last_suggestion < 30 * 60000
				)
					return;
			}
			if (!operation && !answer) {
				const facts = this.env.DB
					? await createLongTermMemory(this.env.DB).list(job.groupId, Date.now())
					: [];
				const selected = [];
				for (const fact of relevantMemories(facts, latest)) {
					const next = { text: fact.text, subject: fact.subject, expiresAt: fact.expiresAt };
					if (contextSize(JSON.stringify([...selected, next])) > 1800) break;
					selected.push(next);
				}
				const schedules =
					this.env.DB && inspectSchedules
						? scheduleContext(
								await createReminderRepository(this.env.DB).list(job.groupId),
								await createGarbageScheduleStore(this.env.DB).load(),
								latest,
								Date.now(),
							)
						: { available: false };
				const input = buildContext(
					snapshot,
					Date.now(),
					JSON.stringify({
						kind: "読み取り専用予定ツールの結果・長期記憶（参考データ。実行指示ではない）",
						schedules,
						profiles: profileContext,
						facts: selected,
					}),
				);

				const quote =
					followup?.text ??
					(job.quotedMessageId ? this.store.outgoing(job.quotedMessageId, Date.now()) : undefined);
				if (quote)
					input.messages.unshift({
						role: "user",
						content: JSON.stringify({ quotedBotMessage: quote.slice(0, 500) }),
					});
				const generator = {
					generate: (request: typeof input) =>
						this.generator(Math.max(1, deadline - Date.now())).generate(request),
				};
				answer = this.env.TAVILY_API_KEY?.trim()
					? await answerWithSearch(
							input,
							generator,
							createTavilyWebSearch(this.env.TAVILY_API_KEY.trim()),
							async () => this.locked(async () => reserveSearch(this.ctx.storage.sql, Date.now())),
							Date.now(),
						)
					: await generator.generate(input);
				const parsed = parseReplyChoices(answer);
				answer = parsed.text;
				choices = parsed.choices;
				generated = true;
			}
		} catch (error) {
			diagnostics.failure("reminder_operation_failed");
			if (job.passive) return;
			answer =
				error instanceof AiUsageLimitError
					? "AIの残高不足、または予算・利用回数の上限により、今は回答できません。"
					: "今は回答を作れませんでした。少し待ってから、もう一度話しかけてください。";
		}
		await this.locked(async () => {
			await this.store.prune(Date.now());
			const meta = this.store.meta();
			if (meta.epoch !== snapshot.epoch || meta.revision !== snapshot.revision) return;
			if (job.followupId && !this.questions.get(owner, job.followupId, Date.now())) return;
			this.quickReplies.clearOwner(owner);
			let proposalButtons: QuickReply[] | undefined;
			const outcome = await this.applyOperation(
				operation,
				{ job, owner, tasksReady, listsReady, taskVersion, listVersion, proactive },
				choices,
			);
			if (outcome && "skip" in outcome) return;
			if (outcome) {
				answer = outcome.text;
				choices = outcome.choices;
				proposalButtons = outcome.buttons;
				generated = true;
			}
			if (!answer) return;
			const text = Array.from(answer).slice(0, 2000).join("");
			// Serialize the final check, delivery, and recording against deletion.
			const speaker = snapshot.messages.at(-1)?.speaker;
			const buttons = this.conversationButtons(choices, speaker, text);
			await sender.reply(job.replyToken, text, proposalButtons ?? buttons);
			this.trackQuestion(owner, text, generated, proposalButtons, operation, choices);
			await this.recordAnswer(job, text, generated);
		});
	}

	private async answerPhoto(job: GenerationJob) {
		const id = job.imageId;
		if (!id || job.groupId !== this.env.LINE_ALLOWED_GROUP_ID?.trim()) return;
		const allowed = await this.locked(async () => this.photos.valid(job.eventId, id, Date.now()));
		if (!allowed) return;
		const text = await analyzePhoto(
			id,
			createLineImageReader(this.env.LINE_CHANNEL_ACCESS_TOKEN ?? ""),
			this.generator(),
		);
		await this.locked(async () => {
			if (!this.photos.valid(job.eventId, id, Date.now())) return;
			await createLineAnswerSender(
				this.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
				job,
				fetch,
				diagnostics,
			).reply(job.replyToken, text);
			this.photos.finish(job.eventId);
		});
	}
	private async flushMemoryDeletions(group: string) {
		const pending = this.store.pendingMemoryDeletions();
		if (!pending.length) return;
		this.quickReplies.clear();
		this.questions.clear();
		this.photos.clear();
		if (!this.env.DB) return;
		const repo = createLongTermMemory(this.env.DB);
		if (pending.includes("profiles:*")) await createFamilyProfiles(this.env.DB).clear(group);
		if (pending.includes("*")) await repo.clear(group);
		else {
			await repo.removeSources(group, pending);
			await createFamilyProfiles(this.env.DB).removeSources(group, pending);
		}
		for (const id of pending) this.store.finishMemoryDeletion(id);
	}
	async scheduleMemory(now: number) {
		const group = this.env.LINE_ALLOWED_GROUP_ID?.trim();
		if (!group || !this.env.DB || !this.env.JOBS_QUEUE) return;
		await this.locked(async () => {
			await this.store.prune(now);
			await this.flushMemoryDeletions(group);
			await createLongTermMemory(this.env.DB as D1Database).list(group, now);
			const token = this.store.claimMemory(now);
			if (!token) return;
			try {
				await this.env.JOBS_QUEUE?.send({
					type: "memory",
					groupId: group,
					token,
				} satisfies MemoryJob);
			} catch (error) {
				this.store.releaseMemory(token);
				throw error;
			}
		});
	}
	async organize(token: string) {
		if (this.organizing) return;
		this.organizing = true;
		try {
			await this.organizeOnce(token);
		} finally {
			this.organizing = false;
		}
	}
	private async organizeOnce(token: string) {
		const group = this.env.LINE_ALLOWED_GROUP_ID?.trim();
		if (!group || !this.env.DB) return;
		const repo = createLongTermMemory(this.env.DB);
		const batch = await this.locked(async () => {
			await this.flushMemoryDeletions(group);
			return this.store.memoryBatch(token, Date.now());
		});
		if (!batch) return;
		// Do not hold the conversation lock while waiting for the LLM.
		const existing = await repo.list(group, Date.now());
		const profileRepo = createFamilyProfiles(this.env.DB);
		const profiles = await profileRepo.list(group);
		const result = await organizeMemory(
			batch,
			relevantMemories(existing, batch.messages.map((m) => m.text).join("\n")),
			this.generator(60_000),
			Date.now(),
			profiles,
		);
		await this.locked(async () => {
			await this.store.prune(Date.now());
			if (!this.store.memoryLeaseValid(token, Date.now())) return;
			await this.flushMemoryDeletions(group);
			await repo.apply(group, result.updates, result.retire, Date.now());
			for (const p of result.profiles) await profileRepo.propose(group, p);
			await this.store.completeMemory(batch, result.summary);
			this.store.releaseMemory(token);
		});
	}

	async recordSent(id: string, text: string) {
		await this.locked(async () => {
			this.store.recordOutgoing(id, text, Date.now());
		});
	}
	async deliver(job: ReminderJob) {
		const group = this.env.LINE_ALLOWED_GROUP_ID?.trim();
		if (!group || job.groupId !== group) return;
		if (!this.env.DB || !this.env.LINE_CHANNEL_ACCESS_TOKEN)
			throw new Error("Missing reminder configuration");
		const repo = createReminderRepository(this.env.DB);
		const sender = createLinePushSender(
			this.env.LINE_CHANNEL_ACCESS_TOKEN,
			fetch,
			diagnostics,
			async (id, text) => {
				this.store.recordOutgoing(id, text, Date.now());
			},
		);
		await this.locked(() => deliverReminder(repo, sender, job, group, Date.now()));
	}
	async deliverTasks() {
		const group = this.env.LINE_ALLOWED_GROUP_ID?.trim();
		if (!group || !this.env.DB || !this.env.LINE_CHANNEL_ACCESS_TOKEN)
			throw new Error("Missing task configuration");
		const db = this.env.DB;
		if (!(await familyTasksReady(db))) return;
		await this.locked(async () => {
			const now = Date.now();
			await deliverTasks(
				createFamilyTasks(db),
				createLinePushSender(
					this.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
					fetch,
					diagnostics,
					async (id, text) => {
						this.store.recordOutgoing(id, text, Date.now());
					},
				),
				group,
				now,
				(task) => {
					const firstPerOwner = task.members
						.map((m) => ({
							member: m,
							occurrence: task.occurrences.find(
								(o) => o.speaker === m.speaker && o.doneAt === null && o.dueAt <= now,
							),
						}))
						.filter((x) => x.occurrence);
					// Each owner gets a separate batch; completing one must not consume another person's button.
					return firstPerOwner.flatMap(({ member, occurrence }) =>
						occurrence
							? this.quickReplies.issue(
									[
										{
											label: `${member.name.slice(0, 12)}さん完了`,
											choice: {
												kind: "task_complete",
												taskId: task.id,
												occurrenceId: occurrence.id,
												owner: member.speaker,
											},
										},
									],
									member.speaker,
									now,
									23 * 3600000,
								)
							: [],
					);
				},
			);
		});
	}

	private async recordAnswer(job: GenerationJob, text: string, generated: boolean) {
		if (generated) {
			const now = Date.now();
			await this.store.append(
				{
					id: `answer:${job.eventId}`,
					role: "assistant",
					speaker: "assistant",
					text,
					occurredAt: now,
					day: new Date(now + 9 * 3600000).toISOString().slice(0, 10),
				},
				`answer:${job.eventId}`,
				now,
			);
		}
	}

	private conversationButtons(choices: string[], speaker: string | undefined, text: string) {
		return choices.length && speaker && speaker !== "unknown"
			? this.quickReplies.issue(
					choices.map((label) => ({
						label,
						choice: {
							kind: "conversation" as const,
							text: label,
							question: text.replace(/https?:\/\/[^\s]+/g, "").slice(0, 1000),
						},
					})),
					speaker,
					Date.now(),
				)
			: undefined;
	}

	private trackQuestion(
		owner: string,
		text: string,
		generated: boolean,
		proposalButtons: QuickReply[] | undefined,
		operation: ReminderAction | undefined,
		choices: string[],
	) {
		this.questions.remove(owner);
		if (
			generated &&
			!proposalButtons &&
			owner !== "unknown" &&
			(operation?.action === "clarify" ||
				choices.length ||
				/[？?]|教えて(?:ください|もらえ|ね)|選んでください/.test(
					text.replace(/https?:\/\/[^\s]+/g, ""),
				))
		)
			this.questions.set(owner, text, Date.now());
	}

	private async applyOperation(
		operation: ReminderAction | undefined,
		context: OperationContext,
		choices: string[],
	): Promise<OperationOutcome | null> {
		if (!operation) return null;
		if (operation.action === "task")
			return { text: await this.applyTask(operation, context), choices, buttons: undefined };
		if (operation.action === "collection" && !context.listsReady)
			return {
				text: "共有リストは準備中です。データベースの更新が完了してから、もう一度お願いします。",
				choices,
				buttons: undefined,
			};
		const db = this.env.DB;
		if (!db) return null;
		if (operation.action === "collection" && operation.collection)
			return this.applyCollection(db, operation.collection, context, choices);
		if (operation.action === "improve")
			return this.proposeImprovement(db, operation, context.job, choices);
		return this.applyReminder(db, operation, context);
	}

	private async applyTask(operation: ReminderAction, context: OperationContext): Promise<string> {
		const { job, owner, tasksReady, taskVersion } = context;
		if (!tasksReady || !this.env.DB)
			return "タスク機能は準備中です。データベースの更新をお待ちください。";
		return manageTasks(
			createFamilyTasks(this.env.DB),
			job.groupId,
			job.eventId,
			operation.task ?? { op: "list" },
			owner,
			await createFamilyProfiles(this.env.DB).list(job.groupId),
			Date.now(),
			taskVersion,
		);
	}

	private async applyCollection(
		db: D1Database,
		collection: NonNullable<ReminderAction["collection"]>,
		context: OperationContext,
		choices: string[],
	): Promise<OperationOutcome> {
		const { job, owner, listVersion } = context;
		const result = await manageLists(
			createFamilyLists(db),
			job.groupId,
			job.eventId,
			collection,
			listVersion,
		);
		const confirmation = result.confirm;
		const buttons = confirmation
			? this.quickReplies.issue(
					[true, false].map((approve) => ({
						label: approve ? "リストを削除" : "キャンセル",
						choice: { kind: "collection_delete" as const, ...confirmation, approve },
					})),
					owner,
					Date.now(),
				)
			: undefined;
		return { text: result.text, choices, buttons };
	}

	private async proposeImprovement(
		db: D1Database,
		operation: ReminderAction,
		job: GenerationJob,
		choices: string[],
	): Promise<OperationOutcome> {
		let buttons: QuickReply[] | undefined;
		if (!this.env.GH_IMPROVEMENT_TOKEN)
			return { text: "自動改善の設定がまだ完了していません。", choices, buttons };
		const text =
			(await handleImprovement(
				{ text: `改善: ${operation.specification}`, groupId: job.groupId, eventId: job.eventId },
				{
					repository: createImprovementRepository(db),
					dispatcher: createImprovementDispatcher(this.env.GH_IMPROVEMENT_TOKEN),
					onProposal: (request) => {
						buttons = this.improvementButtons(request);
					},
				},
			)) ?? "";
		return { text, choices, buttons };
	}

	private async applyReminder(
		db: D1Database,
		operation: ReminderAction,
		context: OperationContext,
	): Promise<OperationOutcome> {
		const { job, proactive } = context;
		const choices = operation.action === "clarify" ? (operation.choices ?? []) : [];
		if (
			proactive &&
			operation.action === "clarify" &&
			Date.now() - this.store.participation().last_suggestion < 30 * 60000
		)
			return { skip: true };
		const text =
			operation.action === "list"
				? scheduleInventory(
						await createReminderRepository(db).list(job.groupId),
						await createGarbageScheduleStore(db).load(),
						1,
						Date.now(),
					)
				: ((await manageReminders(
						createReminderRepository(db),
						job.groupId,
						job.eventId,
						operation,
						Date.now(),
					)) ?? "");
		if (proactive && operation.action === "clarify") this.store.markSuggestion(Date.now());
		return { text, choices, buttons: undefined };
	}

	private followupCandidate(message: IncomingText, now: number) {
		return !message.unsend &&
			!message.mentioned &&
			!message.quotedMessageId &&
			!message.postback &&
			!explicitReminderRequest(message.text) &&
			message.speaker &&
			message.text.length <= 2000
			? this.questions.candidate(message.speaker, message.occurredAt ?? 0, now)
			: undefined;
	}

	private prepareIncoming(message: IncomingText, now: number): IncomingText {
		const replyToBot =
			!!message.quotedMessageId && this.store.outgoing(message.quotedMessageId, now) !== undefined;
		const followup = this.followupCandidate(message, now);
		const bareLink = !message.unsend && !message.quotedMessageId && isBareUrl(message.text);
		const candidate =
			!followup &&
			!bareLink &&
			!message.unsend &&
			!message.mentioned &&
			!replyToBot &&
			message.text.length <= 2000 &&
			reminderCandidate(message.text);
		const explicit = explicitReminderRequest(message.text);
		const passive = candidate && (explicit || now - this.store.participation().last_scan >= 60000);
		if (passive) this.store.markScan(now);
		return {
			...message,
			mentioned: message.mentioned || replyToBot || bareLink,
			...(followup && !bareLink ? { followupId: followup.id } : {}),
			...(passive ? { passive: true } : {}),
		};
	}

	private async rememberText(
		incoming: IncomingText & { eventId: string; messageId: string; occurredAt: number },
		text: string,
		group: string,
		now: number,
		repo: LongTermMemory,
	): Promise<string | null> {
		if (text.length > 300) return "覚える内容は300文字以内で指定してください。";
		if ((await repo.list(group, now)).length >= 200)
			return "長期記憶は200件までです。不要な記憶を削除してください。";
		const ref = await this.store.append(
			{
				id: incoming.messageId,
				role: "user",
				speaker: incoming.speaker ?? "unknown",
				text,
				occurredAt: incoming.occurredAt,
				day: new Date(incoming.occurredAt + 9 * 3600000).toISOString().slice(0, 10),
			},
			incoming.eventId,
			now,
		);
		if (!ref) return null;
		await repo.apply(
			group,
			[
				{
					subject: incoming.speaker ?? "unknown",
					key: `explicit:${incoming.messageId}`,
					text,
					sourceIds: [incoming.messageId],
					expiresAt: null,
				},
			],
			[],
			now,
		);
		return `覚えました。\n${text}`;
	}

	private async forgetFact(
		repo: LongTermMemory,
		group: string,
		id: string,
		now: number,
	): Promise<string> {
		const fact = (await repo.list(group, now)).find((f) => f.id === id);
		if (!fact) return "その記憶は見つかりません。記憶一覧でIDを確認してください。";
		await this.forgetSources(group, fact.sourceIds, now);
		return "記憶と根拠の発言、派生する要約・回答を削除しました。同じ発言を根拠にした他の記憶も削除されます。";
	}

	private async handleMemoryCommand(
		incoming: IncomingText,
		group: string,
		now: number,
		sender: ReplySender,
	): Promise<boolean> {
		if (
			!incoming.mentioned ||
			incoming.unsend ||
			!this.env.DB ||
			!incoming.eventId ||
			!incoming.messageId ||
			incoming.occurredAt === undefined
		)
			return false;
		const command = memoryCommand(incoming.text);
		if (!command) return false;
		const repo = createLongTermMemory(this.env.DB);
		let response: string | null;
		switch (command.type) {
			case "list":
				response = memoryInventory(await repo.list(group, now), command.page);
				break;
			case "schedules":
				response = scheduleInventory(
					await createReminderRepository(this.env.DB).list(group),
					await createGarbageScheduleStore(this.env.DB).load(),
					command.page,
					now,
				);
				break;
			case "clear":
				await this.store.reset(incoming.eventId, incoming.occurredAt, now);
				await this.flushMemoryDeletions(group);
				response =
					"会話履歴・要約・長期記憶を削除しました。登録した通知・共有リスト・家族プロフィールは残っています。";
				break;
			case "forget":
				response = await this.forgetFact(repo, group, command.id, now);
				break;
			case "remember":
				response = await this.rememberText(
					{
						...incoming,
						eventId: incoming.eventId,
						messageId: incoming.messageId,
						occurredAt: incoming.occurredAt,
					},
					command.text,
					group,
					now,
					repo,
				);
				break;
		}
		if (response !== null) await sender.reply(incoming.replyToken, response);
		return true;
	}

	private async forgetSources(group: string, ids: string[], now: number) {
		for (const id of ids) await this.store.forget(id, now);
		await this.flushMemoryDeletions(group);
	}

	private async handleProfileCommand(
		incoming: IncomingText,
		group: string,
		now: number,
		sender: ReplySender,
	): Promise<boolean> {
		if (
			!incoming.mentioned ||
			incoming.unsend ||
			!this.env.DB ||
			!incoming.eventId ||
			incoming.occurredAt === undefined
		)
			return false;
		const command = parseProfileCommand(incoming.text);
		if (!command) return false;
		const eventId = incoming.eventId;
		const occurredAt = incoming.occurredAt;
		const response = await manageProfile(
			command,
			{
				group,
				speaker: incoming.speaker,
				messageId: incoming.messageId,
				occurredAt,
			},
			createFamilyProfiles(this.env.DB),
			{
				clear: async () => {
					this.store.requestProfileClear();
					await this.store.reset(eventId, occurredAt, now);
					await this.flushMemoryDeletions(group);
				},
				forget: (ids) => this.forgetSources(group, ids, now),
			},
		);
		await sender.reply(incoming.replyToken, response);
		return true;
	}

	private async consultOperation(
		operation: ReminderAction,
		latest: string,
		messages: ConversationMessage[],
		deadline: number,
	): Promise<ReminderAction> {
		if (operation.action !== "improve" && operation.action !== "inspect_code") return operation;
		return consultSource(
			latest,
			JSON.stringify(
				messages.slice(-6).map((m) => ({ role: m.role, text: m.text.slice(0, 1000) })),
			),
			operation.action === "improve",
			createSourceRepository(),
			{ generate: (input) => this.generator(Math.max(1, deadline - Date.now())).generate(input) },
		);
	}

	async alarm() {
		this.questions.prune(Date.now());
		this.quickReplies.prune(Date.now());
		this.photos.prune(Date.now());
		await this.locked(() => this.store.prune(Date.now()));
		await this.ctx.storage.setAlarm(Date.now() + 3600000);
	}
}
