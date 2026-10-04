import type { Diagnostics } from "../../application/ports/diagnostics";
import type { PushSender } from "../../application/ports/push-sender";
import { LineReplyError } from "./reply-sender";

export function createLinePushSender(
	accessToken: string,
	fetcher: typeof fetch = fetch,
	diagnostics?: Diagnostics,
	onSent?: (id: string, text: string) => Promise<void>,
): PushSender {
	return {
		async push(to, text, key) {
			const hash = new Uint8Array(
				await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
			);
			hash[6] = ((hash[6] ?? 0) & 15) | 64;
			hash[8] = ((hash[8] ?? 0) & 63) | 128;
			const hex = Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
			const retryKey = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
			const response = await fetcher("https://api.line.me/v2/bot/message/push", {
				method: "POST",
				headers: {
					authorization: `Bearer ${accessToken}`,
					"content-type": "application/json",
					"x-line-retry-key": retryKey,
				},
				body: JSON.stringify({ to: to, messages: [{ type: "text", text }] }),
				signal: AbortSignal.timeout(5000),
			}).catch(() => {
				diagnostics?.failure("line_transport_failed");
				throw new Error("LINE push transport failed");
			});

			if (response.status === 409 && response.headers.has("x-line-accepted-request-id")) return;
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
