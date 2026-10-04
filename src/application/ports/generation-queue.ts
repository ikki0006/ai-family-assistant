import type { MemoryReference } from "../conversation/conversation";
export interface GenerationJob {
	eventId: string;
	memory?: MemoryReference;
	groupId: string;
	text: string;
	replyToken: string;
	receivedAt: number;
}

export interface GenerationQueue {
	enqueue(job: GenerationJob): Promise<void>;
}
