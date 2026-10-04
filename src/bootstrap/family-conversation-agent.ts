import { DurableObject } from "cloudflare:workers";
import { Lifecycle } from "agents/lifecycle";
import { Sessions } from "agents/sessions";
import { buildContext } from "../application/conversation/build-context";
import { receiveConversation } from "../application/conversation/receive-conversation";
import {
	type IncomingText,
	createRespondToMention,
} from "../application/conversation/respond-to-mention";
import { compactConversation } from "../application/memory/compact-conversation";
import type { GenerationJob } from "../application/ports/generation-queue";
import { AiUsageLimitError } from "../application/ports/text-generator";
import { createWorkersAiTextGenerator } from "../infrastructure/ai/workers-ai-text-generator";
import { createLineAnswerSender } from "../infrastructure/line/answer-sender";
import { createLineReplySender } from "../infrastructure/line/reply-sender";
import { SessionConversationStore } from "../infrastructure/memory/session-conversation-store";
import { diagnostics } from "../infrastructure/observability/diagnostics";
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
			await this.ctx.storage.setAlarm(Date.now() + 3600000);
			const sender = createLineReplySender(
				this.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
				fetch,
				diagnostics,
			);
			const respond = createRespondToMention(
				sender,
				group,
				this.env.AI && this.env.AI_GATEWAY_ID ? this.generator() : undefined,
				diagnostics,
				createGenerationQueue(this.env.JOBS_QUEUE),
			);
			await receiveConversation(this.store, group, respond, sender)(message);
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
		);
		let answer: string;
		let generated = false;
		try {
			const deadline = Date.now() + 120_000;
			const context = await compactConversation(snapshot, this.store, this.generator(20_000));
			answer = await this.generator(Math.max(1, deadline - Date.now())).generate(
				buildContext(context, Date.now()),
			);
			generated = true;
		} catch (error) {
			answer =
				error instanceof AiUsageLimitError
					? "AIの予算または利用回数の上限に達したため、今は回答できません。"
					: "今は回答を作れませんでした。少し待ってから、もう一度話しかけてください。";
		}
		await this.locked(async () => {
			await this.store.prune(Date.now());
			const meta = this.store.meta();
			if (meta.epoch !== snapshot.epoch || meta.revision !== snapshot.revision) return;
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
	async alarm() {
		await this.locked(() => this.store.prune(Date.now()));
		await this.ctx.storage.setAlarm(Date.now() + 3600000);
	}
}
