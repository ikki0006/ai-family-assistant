import { expect, it, vi } from "vitest";
import { analyzePhoto } from "../../src/application/photos/analyze-photo";
import { ImageContentError } from "../../src/application/ports/image-content";
import type { TextGenerator } from "../../src/application/ports/text-generator";
import { createLineImageReader } from "../../src/infrastructure/line/image-content";
import { parseGenerationJob } from "../../src/presentation/queue/generation-job";
import { parseWebhook } from "../../src/presentation/router/line-webhook";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
it("accepts group images without mention, ignoring stickers, standby and external content", () => {
	const event = {
		type: "message",
		webhookEventId: "e",
		timestamp: 1,
		replyToken: "r",
		source: { type: "group", groupId: "g" },
		message: { type: "image", id: "123", contentProvider: { type: "line" } },
	};
	expect(parseWebhook(JSON.stringify({ events: [event] }))).toMatchObject([
		{ image: true, messageId: "123", mentioned: false, replyToken: "r" },
	]);
	for (const e of [
		{ ...event, mode: "standby" },
		{ ...event, message: { ...event.message, type: "sticker" } },
		{ ...event, message: { ...event.message, contentProvider: { type: "external" } } },
	])
		expect(parseWebhook(JSON.stringify({ events: [e] }))).toEqual([]);
	expect(
		parseGenerationJob({
			eventId: "e",
			groupId: `C${"1".repeat(32)}`,
			text: "",
			replyToken: "r",
			receivedAt: 1,
			imageId: "123",
		}).imageId,
	).toBe("123");
});
it("fetches image bytes only from LINE and passes inline data with no conversation", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValue(new Response(png, { headers: { "Content-Type": "image/png" } }));
	const reader = createLineImageReader("fictional", fetcher);
	const generator = {
		generate: vi.fn<TextGenerator["generate"]>(async () => "店名：架空店\n合計：100円"),
	};
	expect(await analyzePhoto("123", reader, generator)).toContain("100円");
	expect(fetcher.mock.calls[0]?.[0]).toBe("https://api-data.line.me/v2/bot/message/123/content");
	expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
	const input = generator.generate.mock.calls[0]?.[0] as unknown;
	expect(input).toMatchObject({
		messages: [{ role: "user", image: { mimeType: "image/png", data: "iVBORw0KGgoA" } }],
	});
});
it("rejects oversized streams, unsupported bodies and expired content", async () => {
	for (const response of [
		new Response("", { status: 404 }),
		new Response("html", { headers: { "Content-Type": "image/png" } }),
		new Response(png, {
			headers: { "Content-Type": "image/png", "Content-Length": String(9 * 1024 * 1024) },
		}),
		new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { "Content-Type": "image/png" } }),
	]) {
		await expect(
			createLineImageReader("token", async () => response).read("123"),
		).rejects.toBeInstanceOf(ImageContentError);
	}
	const fetcher = vi.fn<typeof fetch>();
	await expect(createLineImageReader("token", fetcher).read("../123")).rejects.toThrow();
	expect(fetcher).not.toHaveBeenCalled();
});
it("does not call AI when content cannot be retrieved", async () => {
	const generator = { generate: vi.fn() };
	expect(
		await analyzePhoto(
			"123",
			{
				read: async () => {
					throw new ImageContentError("unavailable");
				},
			},
			generator,
		),
	).toContain("送り直し");
	expect(generator.generate).not.toHaveBeenCalled();
});
