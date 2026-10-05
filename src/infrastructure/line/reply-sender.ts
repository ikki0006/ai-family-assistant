import type { Diagnostics } from "../../application/ports/diagnostics";
import type { ReplySender } from "../../application/ports/reply-sender";
import { textMessage } from "./text-message";

export class LineReplyError extends Error {
	constructor(readonly status: number) {
		super("LINE reply failed");
	}
}

export function createLineReplySender(
	accessToken: string,
	fetcher: typeof fetch = fetch,
	diagnostics?: Diagnostics,
	onSent?: (id: string, text: string) => Promise<void>,
): ReplySender {
	return {
		async reply(replyToken, text, choices) {
			const response = await fetcher("https://api.line.me/v2/bot/message/reply", {
				method: "POST",
				headers: {
					authorization: `Bearer ${accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ replyToken, messages: [textMessage(text, choices)] }),
				signal: AbortSignal.timeout(5000),
			}).catch((error: unknown) => {
				diagnostics?.failure("line_transport_failed");
				throw error;
			});
			// Do not log provider response bodies, tokens, or conversations.

			if (!response.ok) {
				diagnostics?.failure(
					response.status === 401 ? "line_auth_failed" : "line_api_failed",
					response.status,
				);
				throw new LineReplyError(response.status);
			}
			if (onSent) {
				const body = (await response.json().catch(() => null)) as {
					sentMessages?: { id?: string }[];
				} | null;
				const id = body?.sentMessages?.[0]?.id;
				if (typeof id === "string") await onSent(id, text);
			} else await response.body?.cancel();
		},
	};
}
