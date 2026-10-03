import type { GenerationQueue } from "../../application/ports/generation-queue";

export function createGenerationQueue(queue?: Queue): GenerationQueue {
	return {
		async enqueue(job) {
			if (!queue) throw new Error("Missing jobs queue");
			await queue.send(job);
		},
	};
}
