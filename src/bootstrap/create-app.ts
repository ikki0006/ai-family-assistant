import { createRespondToMention } from "../application/conversation/respond-to-mention";
import { getHealth } from "../application/health/get-health";
import type { ConfigurationIssue } from "../application/ports/diagnostics";
import { createFuguTextGenerator } from "../infrastructure/ai/fugu-text-generator";
import { createLineReplySender } from "../infrastructure/line/reply-sender";
import { createSignatureVerifier } from "../infrastructure/line/verify-signature";
import { diagnostics } from "../infrastructure/observability/diagnostics";
import { createGenerationQueue } from "../infrastructure/queue/generation-queue";
import { createRouter } from "../presentation/router/create-router";

export interface Bindings {
	JOBS_QUEUE?: Queue;
	DB?: D1Database;
	FUGU_API_KEY?: string;
	LINE_CHANNEL_SECRET?: string;
	LINE_CHANNEL_ACCESS_TOKEN?: string;
	LINE_ALLOWED_GROUP_ID?: string;
}

export function createApp(env: Bindings = {}, fetcher: typeof fetch = fetch) {
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
				? createRespondToMention(
						createLineReplySender(token, fetcher, diagnostics),
						groupId,
						env.FUGU_API_KEY?.trim()
							? createFuguTextGenerator(env.FUGU_API_KEY.trim(), fetcher, diagnostics)
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
