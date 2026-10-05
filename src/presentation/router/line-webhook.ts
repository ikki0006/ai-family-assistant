import { z } from "zod";
import type { IncomingText } from "../../application/conversation/respond-to-mention";

const envelopeSchema = z.object({ events: z.array(z.unknown()).max(100) });
const textEventSchema = z.object({
	type: z.literal("message"),
	webhookEventId: z.string().min(1).max(128).optional(),
	timestamp: z.number().int().nonnegative().optional(),
	mode: z.enum(["active", "standby"]).optional(),
	replyToken: z.string().min(1),
	source: z.object({
		type: z.enum(["user", "group", "room"]),
		groupId: z.string().min(1).optional(),
		userId: z.string().optional(),
	}),
	message: z.object({
		type: z.literal("text"),
		id: z.string().min(1).optional(),
		quotedMessageId: z.string().min(1).optional(),
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
	return envelope.data.events.flatMap<IncomingText>((event) => {
		const postback = z
			.object({
				type: z.literal("postback"),
				mode: z.enum(["active", "standby"]).optional(),
				webhookEventId: z.string().min(1).max(128),
				timestamp: z.number().int().nonnegative(),
				replyToken: z.string().min(1),
				source: z.object({
					type: z.literal("group"),
					groupId: z.string().min(1),
					userId: z.string().optional(),
				}),
				postback: z.object({ data: z.string().max(300) }),
			})
			.safeParse(event);
		if (postback.success) {
			const v = postback.data;
			if (v.mode === "standby" || !/^qr:[a-f0-9-]{36}$/.test(v.postback.data)) return [];
			return [
				{
					eventId: v.webhookEventId,
					messageId: `postback:${v.webhookEventId}`,
					occurredAt: v.timestamp,
					chatType: "group",
					groupId: v.source.groupId,
					...(v.source.userId ? { speaker: v.source.userId } : {}),
					mentioned: false,
					text: "",
					replyToken: v.replyToken,
					postback: v.postback.data,
				},
			];
		}
		const unsend = z
			.object({
				type: z.literal("unsend"),
				webhookEventId: z.string(),
				timestamp: z.number(),
				source: z.object({ type: z.literal("group"), groupId: z.string() }),
				unsend: z.object({ messageId: z.string() }),
			})
			.safeParse(event);
		if (unsend.success)
			return [
				{
					eventId: unsend.data.webhookEventId,
					messageId: unsend.data.unsend.messageId,
					occurredAt: unsend.data.timestamp,
					chatType: "group" as const,
					groupId: unsend.data.source.groupId,
					mentioned: false,
					text: "",
					replyToken: "",
					unsend: true,
				},
			];
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
				...(value.webhookEventId ? { eventId: value.webhookEventId } : {}),
				...(value.message.id ? { messageId: value.message.id } : {}),
				...(value.message.quotedMessageId
					? { quotedMessageId: value.message.quotedMessageId }
					: {}),
				...(value.source.userId ? { speaker: value.source.userId } : {}),
				...(value.timestamp !== undefined ? { occurredAt: value.timestamp } : {}),
				chatType: value.source.type,
				groupId: value.source.groupId,
				mentioned: mentions.length > 0,
				text,
				replyToken: value.replyToken,
			},
		];
	});
}
