import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createRespondToPing } from "../../src/application/conversation/respond-to-ping";
import { createApp } from "../../src/bootstrap/create-app";
import { createLineReplySender } from "../../src/infrastructure/line/reply-sender";
import { createSignatureVerifier } from "../../src/infrastructure/line/verify-signature";

const owner = `U${"1".repeat(32)}`;
const group = `C${"2".repeat(32)}`;
const bindings = {
	LINE_CHANNEL_SECRET: "test-only-secret",
	LINE_CHANNEL_ACCESS_TOKEN: "test-only-token",
	LINE_ALLOWED_USER_ID: owner,
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
		{ type: "follow" },
	])("ignores an event that should not produce a reply", async (value) => {
		const fetcher = vi.fn<typeof fetch>();
		const response = await createApp(bindings, fetcher).request(
			signedRequest(JSON.stringify({ events: [value] })),
		);
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

	it("fails closed when the owner or token is missing", async () => {
		for (const env of [{}, { ...bindings, LINE_ALLOWED_USER_ID: "" }]) {
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

describe("ping use case", () => {
	it("allows group members only after a group has been configured", async () => {
		const reply = vi.fn().mockResolvedValue(undefined);
		const input = {
			actorId: "family-member",
			chatType: "group" as const,
			groupId: group,
			mentioned: true,
			text: "ping",
			replyToken: "reply",
		};
		await createRespondToPing({ reply }, owner)(input);
		expect(reply).not.toHaveBeenCalled();
		await createRespondToPing({ reply }, owner, group)(input);
		expect(reply).toHaveBeenCalledWith("reply", "pong");
	});

	it("limits group ID discovery to the owner and a real mention", async () => {
		const reply = vi.fn().mockResolvedValue(undefined);
		const respond = createRespondToPing({ reply }, owner);
		const input = {
			actorId: owner,
			chatType: "group" as const,
			groupId: group,
			mentioned: true,
			text: "グループID",
			replyToken: "reply",
		};
		await respond({ ...input, mentioned: false });
		await respond({ ...input, actorId: "stranger" });
		expect(reply).not.toHaveBeenCalled();
		await respond(input);
		expect(reply).toHaveBeenCalledWith("reply", `グループID: ${group}`);
	});
});
