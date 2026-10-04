import { createRespondToMention } from "../application/conversation/respond-to-mention";
import type { IncomingText } from "../application/conversation/respond-to-mention";
import { getHealth } from "../application/health/get-health";
import type { GenerationJob } from "../application/ports/generation-queue";
import type { ReminderJob } from "../application/ports/reminder-repository";
import type { ConfigurationIssue } from "../core/diagnostics";
import { createGeminiTextGenerator } from "../infrastructure/ai/gemini-text-generator";
import { createLineReplySender } from "../infrastructure/line/reply-sender";
import { createSignatureVerifier } from "../infrastructure/line/verify-signature";
import { diagnostics } from "../infrastructure/observability/diagnostics";
import { createGenerationQueue } from "../infrastructure/queue/generation-queue";
import { createRouter } from "../presentation/router/create-router";

export interface Bindings {
	JOBS_QUEUE?: Queue;
	CONVERSATIONS?: {
		idFromName(name: string): DurableObjectId;
		get(id: DurableObjectId): {
			receive(message: IncomingText): Promise<void>;
			answer(job: GenerationJob): Promise<void>;
			deliver(job: ReminderJob): Promise<void>;
			scheduleMemory(now: number): Promise<void>;
			organize(token: string): Promise<void>;
			recordSent(id: string, text: string): Promise<void>;
		};
	};
	DB?: D1Database;
	AI?: Pick<Ai, "gateway">;
	AI_GATEWAY_ID?: string;
	TAVILY_API_KEY?: string;
	LINE_CHANNEL_SECRET?: string;
	LINE_CHANNEL_ACCESS_TOKEN?: string;
	LINE_ALLOWED_GROUP_ID?: string;
}

export function createApp(env: Bindings = {}, fetcher: typeof fetch = fetch) {
	const conversations = env.CONVERSATIONS;
	const secret = env.LINE_CHANNEL_SECRET?.trim();
	const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
	const groupId = env.LINE_ALLOWED_GROUP_ID?.trim() || undefined;
	const configurationIssues: ConfigurationIssue[] = [];
	if (!secret) configurationIssues.push("missing_channel_secret");
	if (!token) configurationIssues.push("missing_access_token");
	if (groupId && !/^C[0-9a-f]{32}$/.test(groupId)) configurationIssues.push("invalid_group_id");
	if (!secret || !token || configurationIssues.length > 0) {
		return createRouter({ getHealth, diagnostics, configurationIssues });
	}
	return createRouter({
		getHealth,
		diagnostics,
		line: {
			verifySignature: createSignatureVerifier(secret),
			respond: groupId
				? conversations
					? async (message) => {
							if (message.chatType === "group" && message.groupId === groupId)
								await conversations.get(conversations.idFromName(groupId)).receive(message);
						}
					: createRespondToMention(
							createLineReplySender(token, fetcher, diagnostics),
							groupId,
							env.AI && env.AI_GATEWAY_ID?.trim()
								? createGeminiTextGenerator(env.AI, env.AI_GATEWAY_ID.trim(), diagnostics)
								: undefined,
							diagnostics,
							createGenerationQueue(env.JOBS_QUEUE),
						)
				: async (message) => {
						if (
							message.chatType === "group" &&
							message.mentioned &&
							message.groupId &&
							message.text.trim().toLowerCase() === "グループid"
						)
							diagnostics.groupSetup(message.groupId);
					},
		},
	});
}
