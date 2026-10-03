import type { ReplySender } from "../ports/reply-sender";

export interface IncomingText {
	chatType: "user" | "group" | "room";
	groupId: string | undefined;
	mentioned: boolean;
	text: string;
	replyToken: string;
}

export function createRespondToPing(sender: ReplySender, allowedGroupId: string) {
	return async (message: IncomingText): Promise<void> => {
		if (
			!allowedGroupId ||
			message.chatType !== "group" ||
			message.groupId !== allowedGroupId ||
			!message.mentioned
		)
			return;
		if (message.text.trim().toLowerCase() === "ping") {
			await sender.reply(message.replyToken, "pong");
		}
	};
}
