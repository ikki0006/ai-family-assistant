import type { QuickReply } from "./quick-reply";
export interface ReplySender {
	reply(replyToken: string, text: string, choices?: QuickReply[]): Promise<void>;
}
