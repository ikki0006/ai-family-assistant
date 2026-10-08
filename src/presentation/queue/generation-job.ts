import { z } from "zod";

const jobSchema = z.object({
	eventId: z.string().min(1).max(128),
	imageId: z
		.string()
		.regex(/^[0-9]{1,64}$/)
		.optional(),
	passive: z.boolean().optional(),
	followupId: z.string().uuid().optional(),
	quotedMessageId: z.string().min(1).optional(),
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
	if (!result.text && !result.memory && !result.imageId) throw new Error("Invalid job");
	const { memory, passive, quotedMessageId, imageId, followupId, ...base } = result;
	return {
		...base,
		...(followupId ? { followupId } : {}),
		...(imageId ? { imageId } : {}),
		...(memory ? { memory } : {}),
		...(passive ? { passive } : {}),
		...(quotedMessageId ? { quotedMessageId } : {}),
	};
}
