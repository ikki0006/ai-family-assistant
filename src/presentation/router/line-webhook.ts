import { z } from "zod";
import type { IncomingText } from "../../application/conversation/respond-to-ping";

const envelopeSchema = z.object({ events: z.array(z.unknown()).max(100) });
const textEventSchema = z.object({
	type: z.literal("message"),
	mode: z.enum(["active", "standby"]).optional(),
	replyToken: z.string().min(1),
	source: z.object({
		type: z.enum(["user", "group", "room"]),
		groupId: z.string().min(1).optional(),
	}),
	message: z.object({
		type: z.literal("text"),
		text: z.string().max(5000),
		mention: z
			.object({
				mentionees: z.array(
					z.object({
						type: z.string(),
						isSelf: z.boolean().optional(),
						index: z.number().int().min(0),
						length: z.number().int().min(1),
					}),
				),
			})
			.optional(),
	}),
});

export function parseWebhook(body: string): IncomingText[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return null;
	}
	const envelope = envelopeSchema.safeParse(parsed);
	if (!envelope.success) return null;
	return envelope.data.events.flatMap((event) => {
		const result = textEventSchema.safeParse(event);
		// Non-text, future event types, and standby events require no reply.
		if (!result.success || result.data.mode === "standby") return [];
		const value = result.data;
		const mentions = (value.message.mention?.mentionees ?? [])
			.filter((mention) => mention.type === "user" && mention.isSelf === true)
			.sort((left, right) => right.index - left.index);
		let text = value.message.text;
		let boundary = text.length;
		for (const mention of mentions) {
			if (mention.index + mention.length > boundary) return [];
			// LINE offsets and JS string indices both count UTF-16 code units.
			text = text.slice(0, mention.index) + text.slice(mention.index + mention.length);
			boundary = mention.index;
		}
		return [
			{
				chatType: value.source.type,
				groupId: value.source.groupId,
				mentioned: mentions.length > 0,
				text,
				replyToken: value.replyToken,
			},
		];
	});
}
