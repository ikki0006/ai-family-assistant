export interface QuickReply {
	label: string;
	data: string;
	displayText: string;
}
export type ReplyChoice =
	| { kind: "conversation"; text: string; question: string }
	| { kind: "improvement"; id: string; version: number; approve: boolean };
