import type { Diagnostics } from "../ports/diagnostics";
import type { GenerationQueue } from "../ports/generation-queue";
import type { ReplySender } from "../ports/reply-sender";
import type { TextGenerator } from "../ports/text-generator";

export interface IncomingText {
	eventId?: string;
	chatType: "user" | "group" | "room";
	groupId: string | undefined;
	mentioned: boolean;
	text: string;
	replyToken: string;
}

export function createRespondToMention(
	sender: ReplySender,
	allowedGroupId: string,
	generator?: TextGenerator,
	diagnostics?: Diagnostics,
	jobs?: GenerationQueue,
	now: () => number = Date.now,
) {
	return async (message: IncomingText): Promise<void> => {
		if (
			!allowedGroupId ||
			message.chatType !== "group" ||
			message.groupId !== allowedGroupId ||
			!message.mentioned
		)
			return;
		const text = message.text.trim();
		if (!text) return;
		if (text.toLowerCase() === "ping") {
			await sender.reply(message.replyToken, "pong");
			return;
		}
		if (text === "グループID" || text.toLowerCase() === "グループid") return;
		if (text.length > 2000) {
			await sender.reply(message.replyToken, "一度に送る文章は2,000文字以内にしてください。");
			return;
		}
		if (!generator) {
			diagnostics?.failure("llm_not_configured");
			await sender.reply(message.replyToken, "AIの接続設定がまだ完了していません。");
			return;
		}
		if (jobs) {
			if (!message.eventId) {
				diagnostics?.failure("invalid_payload");
				return;
			}
			await jobs.enqueue({
				eventId: message.eventId,
				groupId: allowedGroupId,
				text,
				replyToken: message.replyToken,
				receivedAt: now(),
			});
			return;
		}
		let answer: string;
		try {
			answer = (await generator.generate(text)).trim();
			if (!answer) throw new Error("Empty model response");
		} catch {
			await sender.reply(
				message.replyToken,
				"今は回答を作れませんでした。少し待ってから、もう一度話しかけてください。",
			);
			return;
		}
		const characters = Array.from(answer);
		const reply =
			characters.length > 2000
				? `${characters.slice(0, 2000).join("")}\n（長いため、ここまで表示しています）`
				: answer;
		await sender.reply(message.replyToken, reply);
	};
}
