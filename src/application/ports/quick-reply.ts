export interface QuickReply {
	label: string;
	data: string;
	displayText: string;
}
export type ReplyChoice =
	| { kind: "conversation"; text: string; question: string }
	| { kind: "collection_delete"; listId: string; version: number; approve: boolean }
	| { kind: "improvement"; id: string; version: number; approve: boolean };
