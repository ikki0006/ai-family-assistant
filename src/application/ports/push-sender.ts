import type { QuickReply } from "./quick-reply";
export interface PushSender {
	push(to: string, text: string, key: string, choices?: QuickReply[]): Promise<void>;
}
