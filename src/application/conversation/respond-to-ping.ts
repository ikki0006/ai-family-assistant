import type { ReplySender } from "../ports/reply-sender";

export interface IncomingText {
	actorId: string;
	chatType: "user" | "group" | "room";
	groupId: string | undefined;
	mentioned: boolean;
	text: string;
	replyToken: string;
}

export function createRespondToPing(
	sender: ReplySender,
	allowedUserId: string,
	allowedGroupId?: string,
) {
	return async (message: IncomingText): Promise<void> => {
		const command = message.text.trim().toLowerCase();
		if (message.chatType === "user") {
			if (message.actorId === allowedUserId && command === "ping") {
				await sender.reply(message.replyToken, "pong");
			}
			return;
		}
		if (message.chatType !== "group" || !message.mentioned || !message.groupId) return;
		// Owner-only setup command: obtain the group ID without logging webhook bodies.
		if (command === "グループid" && message.actorId === allowedUserId) {
			await sender.reply(message.replyToken, `グループID: ${message.groupId}`);
			return;
		}
		const allowed = allowedGroupId
			? message.groupId === allowedGroupId
			: message.actorId === allowedUserId;
		if (allowed && command === "ping") await sender.reply(message.replyToken, "pong");
	};
}
