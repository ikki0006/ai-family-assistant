import { expect, it, vi } from "vitest";
import { createLineAnswerSender } from "../../src/infrastructure/line/answer-sender";

const job = {
	eventId: "test-event",
	groupId: "test-group",
	text: "question",
	replyToken: "reply",
	receivedAt: 1000,
};

it("uses free Reply for answers within the deadline", async () => {
	const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
	await createLineAnswerSender("token", job, fetcher, undefined, () => 44_000).reply(
		"reply",
		"answer",
	);
	expect(fetcher).toHaveBeenCalledOnce();
	expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.line.me/v2/bot/message/reply");
});

it("uses Push beyond the deadline with a stable per-event retry key", async () => {
	const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}"));
	for (let i = 0; i < 2; i++)
		await createLineAnswerSender("token", job, fetcher, undefined, () => 46_000).reply(
			"reply",
			"answer",
		);
	for (const [url, init] of fetcher.mock.calls) {
		expect(url).toBe("https://api.line.me/v2/bot/message/push");
		expect(JSON.parse(String(init?.body))).toEqual({
			to: job.groupId,
			messages: [{ type: "text", text: "answer" }],
		});
	}
	const keys = fetcher.mock.calls.map(([, init]) =>
		new Headers(init?.headers).get("x-line-retry-key"),
	);
	expect(keys[0]).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
	expect(keys[0]).toBe(keys[1]);
});

it("falls back to Push after a definite Reply rejection", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response("invalid reply token", { status: 400 }))
		.mockResolvedValueOnce(new Response("{}"));
	await createLineAnswerSender("token", job, fetcher, undefined, () => 2000).reply(
		"reply",
		"answer",
	);
	expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
		"https://api.line.me/v2/bot/message/reply",
		"https://api.line.me/v2/bot/message/push",
	]);
});

it("does not Push after an ambiguous reply transport error", async () => {
	const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("connection lost"));
	await expect(
		createLineAnswerSender("token", job, fetcher, undefined, () => 2000).reply("reply", "answer"),
	).rejects.toThrow();
	expect(fetcher).toHaveBeenCalledOnce();
});

it("treats an already accepted Push retry as delivered", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValue(
			new Response("{}", { status: 409, headers: { "x-line-accepted-request-id": "accepted" } }),
		);
	await expect(
		createLineAnswerSender("token", job, fetcher, undefined, () => 90_000).reply("reply", "answer"),
	).resolves.toBeUndefined();
});

it("preserves quick replies when an expired reply token falls back to push", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response("", { status: 400 }))
		.mockResolvedValueOnce(new Response("{}"));
	const choices = [{ label: "はい", data: "qr:test", displayText: "はい" }];
	await createLineAnswerSender("token", job, fetcher, undefined, () => 2000).reply(
		"reply",
		"確認？",
		choices,
	);
	expect(fetcher.mock.calls).toHaveLength(2);
	for (const [, init] of fetcher.mock.calls)
		expect(JSON.parse(String(init?.body)).messages[0].quickReply.items[0].action).toEqual({
			type: "postback",
			...choices[0],
		});
});
