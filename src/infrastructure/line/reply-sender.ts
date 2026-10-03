import type { Diagnostics } from "../../application/ports/diagnostics";
import type { ReplySender } from "../../application/ports/reply-sender";

export class LineReplyError extends Error {
	constructor(readonly status: number) {
		super("LINE reply failed");
	}
}

export function createLineReplySender(
	accessToken: string,
	fetcher: typeof fetch = fetch,
	diagnostics?: Diagnostics,
): ReplySender {
	return {
		async reply(replyToken, text) {
			const response = await fetcher("https://api.line.me/v2/bot/message/reply", {
				method: "POST",
				headers: {
					authorization: `Bearer ${accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
				signal: AbortSignal.timeout(5000),
			}).catch((error: unknown) => {
				diagnostics?.failure("line_transport_failed");
				throw error;
			});
			// Do not log provider response bodies, tokens, or conversations.
			await response.body?.cancel();
			if (!response.ok) {
				diagnostics?.failure("line_api_failed", response.status);
				throw new LineReplyError(response.status);
			}
		},
	};
}
