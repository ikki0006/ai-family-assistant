export interface MemoryFact {
	id: string;
	subject: string;
	key: string;
	text: string;
	sourceIds: string[];
	expiresAt: number | null;
	updatedAt: number;
}
export interface MemoryUpdate {
	subject: string;
	key: string;
	text: string;
	sourceIds: string[];
	expiresAt: number | null;
}
export interface LongTermMemory {
	list(group: string, now: number): Promise<MemoryFact[]>;
	apply(group: string, updates: MemoryUpdate[], retire: string[], now: number): Promise<void>;
	removeSources(group: string, ids: string[]): Promise<void>;
	clear(group: string): Promise<void>;
}
export interface MemoryJob {
	type: "memory";
	groupId: string;
	token: string;
}
