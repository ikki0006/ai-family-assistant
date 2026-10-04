import type { Diagnostics } from "../../application/ports/diagnostics";
import type { GenerationJob } from "../../application/ports/generation-queue";
import type { ReplySender } from "../../application/ports/reply-sender";
import { createLinePushSender } from "./push-sender";
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
			await createLinePushSender(accessToken, fetcher, diagnostics).push(
				job.groupId,
				text,
				job.eventId,
			);
		},
	};
}
