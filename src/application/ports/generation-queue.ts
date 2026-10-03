export interface GenerationJob {
	eventId: string;
	groupId: string;
	text: string;
	replyToken: string;
	receivedAt: number;
}

export interface GenerationQueue {
	enqueue(job: GenerationJob): Promise<void>;
}
