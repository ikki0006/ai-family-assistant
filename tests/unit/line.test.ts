import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRespondToMention } from "../../src/application/conversation/respond-to-mention";
import { createApp } from "../../src/bootstrap/create-app";
import { createLineReplySender } from "../../src/infrastructure/line/reply-sender";
import { createSignatureVerifier } from "../../src/infrastructure/line/verify-signature";

afterEach(() => vi.restoreAllMocks());

const owner = `U${"1".repeat(32)}`;
const group = `C${"2".repeat(32)}`;
const bindings = {
	LINE_CHANNEL_SECRET: "test-only-secret",
	LINE_CHANNEL_ACCESS_TOKEN: "test-only-token",
	LINE_ALLOWED_GROUP_ID: group,
};

function event(text: string, isSelf?: boolean) {
	return {
		type: "message",
		mode: "active",
		replyToken: "test-reply",
		source: { type: "group", groupId: group, userId: owner },
		message: {
			type: "text",
			text,
			...(isSelf === undefined
				? {}
				: {
						mention: { mentionees: [{ type: "user", index: 0, length: 4, isSelf }] },
					}),
		},
	};
}

function signedRequest(body: string) {
	return new Request("https://example.test/webhooks/line", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-line-signature": createHmac("sha256", bindings.LINE_CHANNEL_SECRET)
				.update(body)
				.digest("base64"),
		},
		body,
	});
}

describe("signed LINE webhook", () => {
	it("replies to a native bot mention with the injected LINE transport", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
		const app = createApp(bindings, fetcher);
		const body = JSON.stringify({ events: [event("@bot ping", true)] });
		expect((await app.request(signedRequest(body))).status).toBe(200);
		expect(fetcher).toHaveBeenCalledOnce();
		const call = fetcher.mock.calls[0];
		if (!call) throw new Error("Expected a LINE request");
		const [url, options] = call;
		expect(url).toBe("https://api.line.me/v2/bot/message/reply");
		expect(JSON.parse(String(options?.body))).toEqual({
			replyToken: "test-reply",
			messages: [{ type: "text", text: "pong" }],
		});
	});

	it.each([
		event("ping"),
		event("@bot ping"),
		event("@bot ping", false),
		{ ...event("@bot ping", true), mode: "standby" },
		{ ...event("@bot ping", true), source: { type: "group", groupId: "other", userId: owner } },
		{ ...event("@bot ping", true), source: { type: "user" } },
		{ ...event("@bot ping", true), source: { type: "room" } },
		{ type: "follow" },
	])("ignores an event that should not produce a reply", async (value) => {
		const fetcher = vi.fn<typeof fetch>();
		const response = await createApp(
			{
				...bindings,
				AI: { run: vi.fn() } as unknown as Ai,
				AI_GATEWAY_ID: "test-gateway",
				JOBS_QUEUE: {
					send: () => {
						throw new Error("Unexpected enqueue");
					},
				} as unknown as Queue,
			},
			fetcher,
		).request(signedRequest(JSON.stringify({ events: [value] })));
		expect(response.status).toBe(200);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("accepts LINE's empty verification request", async () => {
		const fetcher = vi.fn<typeof fetch>();
		const response = await createApp(bindings, fetcher).request(signedRequest('{"events":[]}'));
		expect(response.status).toBe(200);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("rejects tampering before any reply", async () => {
		const fetcher = vi.fn<typeof fetch>();
		const original = signedRequest('{"events":[]}');
		const changed = new Request(original.url, {
			method: "POST",
			headers: original.headers,
			body: JSON.stringify({ events: [event("@bot ping", true)] }),
		});
		expect((await createApp(bindings, fetcher).request(changed)).status).toBe(401);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("rejects a missing signature", async () => {
		const response = await createApp(bindings).request("/webhooks/line", {
			method: "POST",
			body: '{"events":[]}',
		});
		expect(response.status).toBe(401);
	});

	it("rejects signed invalid JSON and invalid envelopes", async () => {
		for (const body of ["{", '{"events":null}', "[]"]) {
			expect((await createApp(bindings).request(signedRequest(body))).status).toBe(400);
		}
	});

	it("fails closed when credentials are missing or the group ID is malformed", async () => {
		for (const env of [
			{},
			{ ...bindings, LINE_CHANNEL_ACCESS_TOKEN: "" },
			{ ...bindings, LINE_ALLOWED_GROUP_ID: "bad" },
		]) {
			expect((await createApp(env).request(signedRequest('{"events":[]}'))).status).toBe(503);
			expect((await createApp(env).request("/health")).status).toBe(200);
		}
	});

	it("returns a retryable error without exposing LINE errors", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("private", { status: 500 }));
		const response = await createApp(bindings, fetcher).request(
			signedRequest(JSON.stringify({ events: [event("@bot ping", true)] })),
		);
		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({ error: "reply_failed" });
	});

	it("uses byte-exact verification including Japanese and newlines", async () => {
		const body = '{\n"text":"こんにちは\\n"}';
		const signature = createHmac("sha256", "secret").update(body).digest("base64");
		const verify = createSignatureVerifier("secret");
		expect(await verify(await new Response(body).arrayBuffer(), signature)).toBe(true);
		expect(await verify(await new Response(`${body} `).arrayBuffer(), signature)).toBe(false);
		expect(await verify(new ArrayBuffer(0), "bad-base64")).toBe(false);
	});

	it("does not swallow transport failures", async () => {
		const sender = createLineReplySender(
			"token",
			vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
		);
		await expect(sender.reply("reply", "pong")).rejects.toThrow("offline");
	});
});

describe("group-only access", () => {
	it("allows a configured group's member without requiring a user ID", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
		const value = { ...event("@bot ping", true), source: { type: "group", groupId: group } };
		expect(
			(
				await createApp(bindings, fetcher).request(
					signedRequest(JSON.stringify({ events: [value] })),
				)
			).status,
		).toBe(200);
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it("never replies with an empty allowlist", async () => {
		const reply = vi.fn();
		await createRespondToMention(
			{ reply },
			"",
		)({ chatType: "group", groupId: group, mentioned: true, text: "ping", replyToken: "reply" });
		expect(reply).not.toHaveBeenCalled();
	});

	it("logs only the group ID for a signed setup command and never replies in setup mode", async () => {
		const output = vi.spyOn(console, "info").mockImplementation(() => {});
		const fetcher = vi.fn<typeof fetch>();
		const app = createApp({ ...bindings, LINE_ALLOWED_GROUP_ID: "" }, fetcher);
		const values = [
			event("@bot ping", true),
			event("グループID"),
			event("@bot グループID", false),
			{ ...event("@bot グループID", true), source: { type: "user" } },
			{
				...event("@bot グループID", true),
				source: { type: "group", groupId: "private-invalid-value" },
			},
		];
		for (const value of values) {
			expect((await app.request(signedRequest(JSON.stringify({ events: [value] })))).status).toBe(
				200,
			);
		}
		expect(output).not.toHaveBeenCalled();
		expect((await app.request(signedRequest('{"events":[]}'))).status).toBe(200);
		await app.request(signedRequest(JSON.stringify({ events: [event("@bot グループID", true)] })));
		expect(output.mock.calls).toEqual([
			[JSON.stringify({ event: "group_setup_required", groupId: group })],
		]);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("never logs a setup ID before signature verification or after group configuration", async () => {
		const output = vi.spyOn(console, "info").mockImplementation(() => {});
		const fetcher = vi.fn<typeof fetch>();
		const body = JSON.stringify({ events: [event("@bot グループID", true)] });
		const setup = createApp({ ...bindings, LINE_ALLOWED_GROUP_ID: "" }, fetcher);
		expect((await setup.request("/webhooks/line", { method: "POST", body })).status).toBe(401);
		await createApp(bindings, fetcher).request(signedRequest(body));
		expect(output).not.toHaveBeenCalled();
		expect(fetcher).not.toHaveBeenCalled();
	});
});

it("enqueues a signed mention without waiting for or calling Workers AI", async () => {
	const send = vi.fn().mockResolvedValue(undefined);
	const fetcher = vi.fn<typeof fetch>();
	const app = createApp(
		{
			...bindings,
			AI: { run: vi.fn() } as unknown as Ai,
			AI_GATEWAY_ID: "test-gateway",
			JOBS_QUEUE: { send } as unknown as Queue,
		},
		fetcher,
	);
	const message = { ...event("@bot こんにちは", true), webhookEventId: "test-event" };
	expect((await app.request(signedRequest(JSON.stringify({ events: [message] })))).status).toBe(
		200,
	);
	expect(send).toHaveBeenCalledExactlyOnceWith({
		eventId: "test-event",
		groupId: group,
		replyToken: "test-reply",
		text: "こんにちは",
		receivedAt: expect.any(Number),
	});
	expect(fetcher).not.toHaveBeenCalled();
});

it("fails the webhook if durable enqueue fails", async () => {
	const send = vi.fn().mockRejectedValue(new Error("queue unavailable"));
	const fetcher = vi.fn<typeof fetch>();
	const app = createApp(
		{
			...bindings,
			AI: { run: vi.fn() } as unknown as Ai,
			AI_GATEWAY_ID: "test-gateway",
			JOBS_QUEUE: { send } as unknown as Queue,
		},
		fetcher,
	);
	expect(
		(
			await app.request(
				signedRequest(
					JSON.stringify({
						events: [{ ...event("@bot こんにちは", true), webhookEventId: "test-event" }],
					}),
				),
			)
		).status,
	).toBe(502);
	expect(fetcher).not.toHaveBeenCalled();
});
