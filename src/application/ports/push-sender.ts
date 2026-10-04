export interface PushSender {
	push(to: string, text: string, key: string): Promise<void>;
}
