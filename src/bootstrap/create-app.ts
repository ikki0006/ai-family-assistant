import { createRespondToPing } from "../application/conversation/respond-to-ping";
import { getHealth } from "../application/health/get-health";
import { createLineReplySender } from "../infrastructure/line/reply-sender";
import { createSignatureVerifier } from "../infrastructure/line/verify-signature";
import { diagnostics } from "../infrastructure/observability/diagnostics";
import { createRouter } from "../presentation/router/create-router";

export interface Bindings {
	LINE_CHANNEL_SECRET?: string;
	LINE_CHANNEL_ACCESS_TOKEN?: string;
	LINE_ALLOWED_USER_ID?: string;
	LINE_ALLOWED_GROUP_ID?: string;
}

export function createApp(env: Bindings = {}, fetcher: typeof fetch = fetch) {
	const secret = env.LINE_CHANNEL_SECRET?.trim();
	const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
	const userId = env.LINE_ALLOWED_USER_ID?.trim();
	const groupId = env.LINE_ALLOWED_GROUP_ID?.trim() || undefined;
	if (
		!secret ||
		!token ||
		!userId ||
		!/^U[0-9a-f]{32}$/.test(userId) ||
		(groupId && !/^C[0-9a-f]{32}$/.test(groupId))
	) {
		return createRouter({ getHealth, diagnostics });
	}
	return createRouter({
		getHealth,
		diagnostics,
		line: {
			verifySignature: createSignatureVerifier(secret),
			respond: createRespondToPing(
				createLineReplySender(token, fetcher, diagnostics),
				userId,
				groupId,
			),
		},
	});
}
