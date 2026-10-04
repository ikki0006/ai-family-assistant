import type { ConversationStore } from "../ports/conversation-store";
import type { ReplySender } from "../ports/reply-sender";
import type { IncomingText } from "./respond-to-mention";

export function receiveConversation(
	store: ConversationStore,
	allowedGroup: string,
	respond: (message: IncomingText) => Promise<void>,
	sender: ReplySender,
	now: () => number = Date.now,
) {
	return async (message: IncomingText) => {
		if (message.chatType !== "group" || message.groupId !== allowedGroup) return;
		if (message.unsend && message.messageId) {
			await store.forget(message.messageId, now());
			return;
		}
		if (!message.eventId || !message.messageId || message.occurredAt === undefined) return;
		if (message.mentioned && message.text.trim() === "履歴リセット") {
			await store.reset(message.eventId, message.occurredAt, now());
			await sender.reply(
				message.replyToken,
				"会話履歴と要約を削除しました。LINE上のメッセージは残ります。",
			);
			return;
		}
		if (message.mentioned && ["ping", "グループid"].includes(message.text.trim().toLowerCase())) {
			await respond(message);
			return;
		}
		const memory = await store.append(
			{
				id: message.messageId,
				role: "user",
				text: message.text,
				speaker: message.speaker ?? "unknown",
				occurredAt: message.occurredAt,
				day: new Date(message.occurredAt + 9 * 3600000).toISOString().slice(0, 10),
			},
			message.eventId,
			now(),
		);
		if (memory && (message.mentioned || message.passive)) await respond({ ...message, memory });
	};
}
