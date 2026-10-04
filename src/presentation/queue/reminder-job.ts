import { z } from "zod";
const schema = z.object({
	type: z.literal("reminder"),
	groupId: z.string().regex(/^C[0-9a-f]{32}$/),
	id: z.string().min(1).max(128),
	version: z.number().int().positive(),
	at: z.number().int().nonnegative(),
});
export function parseReminderJob(value: unknown) {
	return schema.parse(value);
}
