import type {
	ConversationMessage,
	ConversationSnapshot,
	MemoryReference,
} from "../conversation/conversation";
export interface ConversationStore {
	append(
		message: ConversationMessage,
		eventId: string,
		now: number,
	): Promise<MemoryReference | null>;
	snapshot(reference: MemoryReference, now: number): Promise<ConversationSnapshot | null>;
	saveSummary(day: string, text: string, through: number, revision: number): Promise<boolean>;
	forget(messageId: string, now: number): Promise<void>;
	reset(eventId: string, occurredAt: number, now: number): Promise<void>;
	prune(now: number): Promise<void>;
}
