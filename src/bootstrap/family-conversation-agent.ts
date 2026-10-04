import { DurableObject } from "cloudflare:workers";
import { Lifecycle } from "agents/lifecycle";
import { Sessions } from "agents/sessions";
import { buildContext } from "../application/conversation/build-context";
import {
	explicitReminderRequest,
	reminderCandidate,
} from "../application/conversation/participation";
import { receiveConversation } from "../application/conversation/receive-conversation";
import {
	type IncomingText,
	createRespondToMention,
} from "../application/conversation/respond-to-mention";
import { compactConversation } from "../application/memory/compact-conversation";
import type { GenerationJob } from "../application/ports/generation-queue";
import type { ReminderJob } from "../application/ports/reminder-repository";
import { AiUsageLimitError } from "../application/ports/text-generator";
import { participationPrompt, reminderPlannerPrompt } from "../application/prompts/reminders";
import { deliverReminder } from "../application/reminders/deliver-reminder";
import { manageReminders, parseReminderAction } from "../application/reminders/manage-reminders";
import type { ReminderAction } from "../application/reminders/manage-reminders";
import { createWorkersAiTextGenerator } from "../infrastructure/ai/workers-ai-text-generator";
import { createLineAnswerSender } from "../infrastructure/line/answer-sender";
import { createLinePushSender } from "../infrastructure/line/push-sender";
import { createLineReplySender } from "../infrastructure/line/reply-sender";
import { SessionConversationStore } from "../infrastructure/memory/session-conversation-store";
import { diagnostics } from "../infrastructure/observability/diagnostics";
import { createReminderRepository } from "../infrastructure/persistence/d1/reminders";
import { createGenerationQueue } from "../infrastructure/queue/generation-queue";
import type { Bindings } from "./create-app";

export class FamilyConversationAgent extends DurableObject<Bindings> {
	readonly sessions = new Sessions();
	readonly lifecycle = Lifecycle.install(this).use(this.sessions);
	private readonly store = new SessionConversationStore(this.ctx.storage.sql, this.sessions);
	private serial: Promise<unknown> = Promise.resolve();
	private locked<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.serial.then(fn, fn);
		this.serial = next.catch(() => {});
		return next;
	}
	private generator(timeoutMs = 120_000) {
		if (!this.env.AI || !this.env.AI_GATEWAY_ID) throw new Error("Missing AI configuration");
		return createWorkersAiTextGenerator(
			this.env.AI,
			this.env.AI_GATEWAY_ID,
			diagnostics,
			timeoutMs,
		);
	}
	async receive(message: IncomingText): Promise<void> {
		const group = this.env.LINE_ALLOWED_GROUP_ID?.trim();
		if (!group || message.groupId !== group || message.chatType !== "group") return;
		await this.locked(async () => {
			const now = Date.now();
			const replyToBot =
				!!message.quotedMessageId &&
				this.store.outgoing(message.quotedMessageId, now) !== undefined;
			const candidate =
				!message.unsend &&
				!message.mentioned &&
				!replyToBot &&
				message.text.length <= 2000 &&
				reminderCandidate(message.text);
			const explicit = explicitReminderRequest(message.text);
			const passive =
				candidate && (explicit || now - this.store.participation().last_scan >= 60000);
			if (passive) this.store.markScan(now);
			const incoming = {
				...message,
				mentioned: message.mentioned || replyToBot,
				...(passive ? { passive: true } : {}),
			};
			await this.ctx.storage.setAlarm(Date.now() + 3600000);
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
			await receiveConversation(this.store, group, respond, sender)(incoming);
		});
	}
	async answer(job: GenerationJob): Promise<void> {
		if (job.groupId !== this.env.LINE_ALLOWED_GROUP_ID?.trim() || !job.memory) return;
		const reference = job.memory;
		const snapshot = await this.locked(() => this.store.snapshot(reference, Date.now()));
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
		let operation: ReminderAction | undefined;
		let generated = false;
		const latest = snapshot.messages.at(-1)?.text ?? "";
		const proactive = job.passive === true && !explicitReminderRequest(latest);
		try {
			const deadline = Date.now() + 120_000;
			if (this.env.DB) {
				const existing = await createReminderRepository(this.env.DB).list(job.groupId);
				const quoted = job.quotedMessageId
					? this.store.outgoing(job.quotedMessageId, Date.now())
					: undefined;
				const plan = await this.generator(30_000).generate({
					system: reminderPlannerPrompt + participationPrompt,
					messages: [
						{
							role: "user",
							content: JSON.stringify({
								now: new Date(Date.now() + 9 * 3600000).toISOString().replace("Z", "+09:00"),
								passive: job.passive === true,
								latest,
								quoted,
								history: snapshot.messages
									.slice(-6)
									.map((m) => ({ role: m.role, text: m.text.slice(0, 1000) })),
								existing: existing.map((r) => ({
									id: r.id,
									version: r.version,
									title: r.title,
									kind: r.kind,
									at: new Date(r.next_at + 9 * 3600000).toISOString().replace("Z", "+09:00"),
									status: r.status,
								})),
							}),
						},
					],
				});
				operation = parseReminderAction(plan);
				if (proactive && !["none", "clarify"].includes(operation.action))
					operation = {
						action: "clarify",
						question: "その予定、リマインドを登録しますか？通知したい日時と内容を教えてください。",
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
			if (!operation) {
				const context = await compactConversation(snapshot, this.store, this.generator(20_000));
				const input = buildContext(context, Date.now());
				const quote = job.quotedMessageId
					? this.store.outgoing(job.quotedMessageId, Date.now())
					: undefined;
				if (quote)
					input.messages.unshift({
						role: "user",
						content: JSON.stringify({ quotedBotMessage: quote.slice(0, 500) }),
					});
				answer = await this.generator(Math.max(1, deadline - Date.now())).generate(input);
				generated = true;
			}
		} catch (error) {
			diagnostics.failure("reminder_operation_failed");
			if (job.passive) return;
			answer =
				error instanceof AiUsageLimitError
					? "AIの予算または利用回数の上限に達したため、今は回答できません。"
					: "今は回答を作れませんでした。少し待ってから、もう一度話しかけてください。";
		}
		await this.locked(async () => {
			await this.store.prune(Date.now());
			const meta = this.store.meta();
			if (meta.epoch !== snapshot.epoch || meta.revision !== snapshot.revision) return;
			if (operation && this.env.DB) {
				if (
					proactive &&
					operation.action === "clarify" &&
					Date.now() - this.store.participation().last_suggestion < 30 * 60000
				)
					return;
				answer =
					(await manageReminders(
						createReminderRepository(this.env.DB),
						job.groupId,
						job.eventId,
						operation,
						Date.now(),
					)) ?? "";
				generated = true;
				if (proactive && operation.action === "clarify") this.store.markSuggestion(Date.now());
			}
			if (!answer) return;
			const text = Array.from(answer).slice(0, 2000).join("");
			// Serialize the final check, delivery, and recording against deletion.
			await sender.reply(job.replyToken, text);
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
	async alarm() {
		await this.locked(() => this.store.prune(Date.now()));
		await this.ctx.storage.setAlarm(Date.now() + 3600000);
	}
}
