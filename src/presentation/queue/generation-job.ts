import { z } from "zod";

const jobSchema = z.object({
	eventId: z.string().min(1).max(128),
	groupId: z.string().regex(/^C[0-9a-f]{32}$/),
	text: z.string().trim().max(2000),
	memory: z
		.object({ messageId: z.string().min(1), epoch: z.number().int().nonnegative() })
		.optional(),
	replyToken: z.string().min(1),
	receivedAt: z.number().int().nonnegative(),
});

export function parseGenerationJob(value: unknown) {
	const result = jobSchema.parse(value);
	if (!result.text && !result.memory) throw new Error("Invalid job");
	const { memory, ...base } = result;
	return { ...base, ...(memory ? { memory } : {}) };
}
