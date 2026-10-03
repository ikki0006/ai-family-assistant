import { createRespondToPing } from "../application/conversation/respond-to-ping";
import { getHealth } from "../application/health/get-health";
import type { ConfigurationIssue } from "../application/ports/diagnostics";
import { createLineReplySender } from "../infrastructure/line/reply-sender";
import { createSignatureVerifier } from "../infrastructure/line/verify-signature";
import { diagnostics } from "../infrastructure/observability/diagnostics";
import { createRouter } from "../presentation/router/create-router";

export interface Bindings {
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
				? createRespondToPing(createLineReplySender(token, fetcher, diagnostics), groupId)
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
