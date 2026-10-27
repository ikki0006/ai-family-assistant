import { createRespondToMention } from "../application/conversation/respond-to-mention";
import { createGeminiTextGenerator } from "../infrastructure/ai/gemini-text-generator";
import { createLineAnswerSender } from "../infrastructure/line/answer-sender";
import { diagnostics } from "../infrastructure/observability/diagnostics";
import { createGenerationClaims } from "../infrastructure/persistence/d1/generation-claims";
import { parseGenerationJob } from "../presentation/queue/generation-job";
import { parseReminderJob } from "../presentation/queue/reminder-job";
import type { Bindings } from "./create-app";

function conversation(env: Bindings, group: string) {
	if (!env.CONVERSATIONS) throw new Error("Missing conversations binding");
	return env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(group));
}

async function processMemory(body: Record<string, unknown>, env: Bindings) {
	if (typeof body.groupId !== "string" || typeof body.token !== "string" || body.token.length > 100)
		return;
	if (body.groupId !== env.LINE_ALLOWED_GROUP_ID?.trim()) return;
	await conversation(env, body.groupId).organize(body.token);
}

async function processTypedJob(body: unknown, env: Bindings): Promise<boolean> {
	if (typeof body !== "object" || body === null || !("type" in body)) return false;
	switch (body.type) {
		case "memory":
			await processMemory(body, env);
			return true;
		case "reminder": {
			const job = parseReminderJob(body);
			if (job.groupId === env.LINE_ALLOWED_GROUP_ID?.trim())
				await conversation(env, job.groupId).deliver(job);
			return true;
		}
		case "tasks": {
			const group = "groupId" in body ? body.groupId : undefined;
			if (typeof group === "string" && group === env.LINE_ALLOWED_GROUP_ID?.trim())
				await conversation(env, group).deliverTasks();
			return true;
		}
		default:
			return false;
	}
}

async function processGeneration(body: unknown, env: Bindings, fetcher: typeof fetch) {
	const job = parseGenerationJob(body);
	const now = Date.now();
	if (
		job.groupId !== env.LINE_ALLOWED_GROUP_ID?.trim() ||
		now - job.receivedAt > 10 * 60_000 ||
		job.receivedAt > now + 60_000
	)
		return;
	const gatewayId = env.AI_GATEWAY_ID?.trim();
	const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
	if (!env.AI || !gatewayId || !token || !env.DB)
		throw new Error("Missing generation configuration");
	if (!(await createGenerationClaims(env.DB).claim(job.eventId, now))) return;
	if (env.CONVERSATIONS) {
		if (job.memory || job.imageId) await conversation(env, job.groupId).answer(job);
		return;
	}
	if (job.imageId) throw new Error("Missing conversations binding for image");
	const respond = createRespondToMention(
		createLineAnswerSender(token, job, fetcher, diagnostics),
		job.groupId,
		createGeminiTextGenerator(env.AI, gatewayId, diagnostics),
		diagnostics,
	);
	await respond({ ...job, chatType: "group", mentioned: true });
}

export async function processGenerationBatch(
	batch: MessageBatch<unknown>,
	env: Bindings,
	fetcher: typeof fetch = fetch,
) {
	for (const message of batch.messages) {
		try {
			if (!(await processTypedJob(message.body, env)))
				await processGeneration(message.body, env, fetcher);
			message.ack();
		} catch {
			// Do not log the queued message or exception, both may contain personal data.
			diagnostics.failure("generation_job_failed");
			message.retry();
		}
	}
}
