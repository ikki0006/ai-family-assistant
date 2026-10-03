import type { Diagnostics } from "../../application/ports/diagnostics";
import type { GenerationJob } from "../../application/ports/generation-queue";
import type { ReplySender } from "../../application/ports/reply-sender";
import { LineReplyError, createLineReplySender } from "./reply-sender";

export function createLineAnswerSender(
	accessToken: string,
	job: GenerationJob,
	fetcher: typeof fetch = fetch,
	diagnostics?: Diagnostics,
	now: () => number = Date.now,
): ReplySender {
	const replySender = createLineReplySender(accessToken, fetcher, diagnostics);
	return {
		async reply(_replyToken, text) {
			// Leave margin for LINE transport and token expiry.
			if (now() - job.receivedAt < 45_000) {
				try {
					await replySender.reply(job.replyToken, text);
					return;
				} catch (error) {
					// Only a definite rejection falls back; ambiguous failures could duplicate replies.
					if (!(error instanceof LineReplyError) || error.status !== 400) throw error;
				}
			}
			const hash = new Uint8Array(
				await crypto.subtle.digest("SHA-256", new TextEncoder().encode(job.eventId)),
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
				body: JSON.stringify({ to: job.groupId, messages: [{ type: "text", text }] }),
				signal: AbortSignal.timeout(5000),
			}).catch(() => {
				diagnostics?.failure("line_transport_failed");
				throw new Error("LINE push transport failed");
			});
			await response.body?.cancel();
			if (response.status === 409 && response.headers.has("x-line-accepted-request-id")) return;
			if (!response.ok) {
				diagnostics?.failure(
					response.status === 401 ? "line_auth_failed" : "line_api_failed",
					response.status,
				);
				throw new LineReplyError(response.status);
			}
		},
	};
}
