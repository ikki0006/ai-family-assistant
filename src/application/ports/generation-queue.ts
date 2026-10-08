import type { MemoryReference } from "../conversation/conversation";
export interface GenerationJob {
	eventId: string;
	imageId?: string;
	passive?: boolean;
	followupId?: string;
	quotedMessageId?: string;
	memory?: MemoryReference;
	groupId: string;
	text: string;
	replyToken: string;
	receivedAt: number;
}

export interface GenerationQueue {
	enqueue(job: GenerationJob): Promise<void>;
}
