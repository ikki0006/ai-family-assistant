import { createRespondToMention } from "../application/conversation/respond-to-mention";
import { createGeminiTextGenerator } from "../infrastructure/ai/gemini-text-generator";
import { createLineAnswerSender } from "../infrastructure/line/answer-sender";
import { diagnostics } from "../infrastructure/observability/diagnostics";
import { createGenerationClaims } from "../infrastructure/persistence/d1/generation-claims";
import { parseGenerationJob } from "../presentation/queue/generation-job";
import { parseReminderJob } from "../presentation/queue/reminder-job";
import type { Bindings } from "./create-app";

export async function processGenerationBatch(
	batch: MessageBatch<unknown>,
	env: Bindings,
	fetcher: typeof fetch = fetch,
) {
	for (const message of batch.messages) {
		try {
			if (
				typeof message.body === "object" &&
				message.body !== null &&
				"type" in message.body &&
				message.body.type === "memory"
			) {
				const job = message.body as Record<string, unknown>;
				if (
					typeof job.groupId !== "string" ||
					typeof job.token !== "string" ||
					job.token.length > 100
				) {
					message.ack();
					continue;
				}
				if (job.groupId === env.LINE_ALLOWED_GROUP_ID?.trim()) {
					if (!env.CONVERSATIONS) throw new Error("Missing conversations binding");
					await env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(job.groupId)).organize(
						job.token,
					);
				}
				message.ack();
				continue;
			}
			if (
				typeof message.body === "object" &&
				message.body !== null &&
				"type" in message.body &&
				message.body.type === "reminder"
			) {
				const job = parseReminderJob(message.body);
				if (job.groupId === env.LINE_ALLOWED_GROUP_ID?.trim()) {
					if (!env.CONVERSATIONS) throw new Error("Missing conversations binding");
					await env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(job.groupId)).deliver(job);
				}
				message.ack();
				continue;
			}
			const job = parseGenerationJob(message.body);
			const now = Date.now();
			if (
				job.groupId !== env.LINE_ALLOWED_GROUP_ID?.trim() ||
				now - job.receivedAt > 10 * 60_000 ||
				job.receivedAt > now + 60_000
			) {
				message.ack();
				continue;
			}
			const gatewayId = env.AI_GATEWAY_ID?.trim();
			const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
			if (!env.AI || !gatewayId || !token || !env.DB)
				throw new Error("Missing generation configuration");
			if (!(await createGenerationClaims(env.DB).claim(job.eventId, now))) {
				message.ack();
				continue;
			}
			if (env.CONVERSATIONS) {
				if (job.memory)
					await env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(job.groupId)).answer(job);
				message.ack();
				continue;
			}
			const respond = createRespondToMention(
				createLineAnswerSender(token, job, fetcher, diagnostics),
				job.groupId,
				createGeminiTextGenerator(env.AI, gatewayId, diagnostics),
				diagnostics,
			);
			await respond({ ...job, chatType: "group", mentioned: true });
			message.ack();
		} catch {
			// Do not log the queued message or exception, both may contain personal data.
			diagnostics.failure("generation_job_failed");
			message.retry();
		}
	}
}
