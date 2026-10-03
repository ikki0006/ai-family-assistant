export interface ReplySender {
	reply(replyToken: string, text: string): Promise<void>;
}
