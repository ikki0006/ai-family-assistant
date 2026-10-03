import { z } from "zod";

const jobSchema = z.object({
	eventId: z.string().min(1).max(128),
	groupId: z.string().regex(/^C[0-9a-f]{32}$/),
	text: z.string().trim().min(1).max(2000),
	replyToken: z.string().min(1),
	receivedAt: z.number().int().nonnegative(),
});

export function parseGenerationJob(value: unknown) {
	return jobSchema.parse(value);
}
