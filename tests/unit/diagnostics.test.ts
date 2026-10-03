import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../../src/bootstrap/create-app";
import { createLineReplySender } from "../../src/infrastructure/line/reply-sender";
import { diagnostics } from "../../src/infrastructure/observability/diagnostics";
import { createRouter } from "../../src/presentation/router/create-router";

afterEach(() => vi.restoreAllMocks());

it("logs only a fixed code when a handler throws private data", async () => {
	const output = vi.spyOn(console, "error").mockImplementation(() => {});
	const router = createRouter({
		diagnostics,
		getHealth() {
			throw new Error("private conversation and credential");
		},
	});
	expect((await router.request("/health?private=query")).status).toBe(500);
	expect(output.mock.calls).toEqual([[JSON.stringify({ event: "internal_error" })]]);
});

it("reports missing LINE configuration without logging request data", async () => {
	const output = vi.spyOn(console, "error").mockImplementation(() => {});
	const response = await createApp().request("/webhooks/line", {
		method: "POST",
		body: "private conversation",
	});
	expect(response.status).toBe(503);
	expect(output.mock.calls).toEqual([[JSON.stringify({ event: "line_not_configured" })]]);
});

it("records LINE's status without exposing tokens, messages, or provider bodies", async () => {
	const output = vi.spyOn(console, "error").mockImplementation(() => {});
	const sender = createLineReplySender(
		"private-token",
		vi.fn<typeof fetch>().mockResolvedValue(new Response("private provider body", { status: 401 })),
		diagnostics,
	);
	await expect(sender.reply("private-reply-token", "private conversation")).rejects.toThrow();
	expect(output.mock.calls).toEqual([
		[JSON.stringify({ event: "line_api_failed", upstreamStatus: 401 })],
	]);
});

it("classifies transport errors without logging their messages", async () => {
	const output = vi.spyOn(console, "error").mockImplementation(() => {});
	const sender = createLineReplySender(
		"private-token",
		vi.fn<typeof fetch>().mockRejectedValue(new Error("private URL and credential")),
		diagnostics,
	);
	await expect(sender.reply("reply", "text")).rejects.toThrow();
	expect(output.mock.calls).toEqual([[JSON.stringify({ event: "line_transport_failed" })]]);
});
