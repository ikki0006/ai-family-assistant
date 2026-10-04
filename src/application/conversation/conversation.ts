export interface ConversationMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
	speaker: string;
	occurredAt: number;
	day: string;
}
export interface GenerationInput {
	system: string;
	messages: { role: "user" | "assistant"; content: string }[];
}
export interface MemoryReference {
	messageId: string;
	epoch: number;
}
export interface ConversationSnapshot {
	revision: number;
	epoch: number;
	messages: ConversationMessage[];
	summaries: { day: string; text: string; through: number }[];
}
