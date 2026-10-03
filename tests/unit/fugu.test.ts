import { afterEach, expect, it, vi } from "vitest";
import { createFuguTextGenerator } from "../../src/infrastructure/ai/fugu-text-generator";
import { diagnostics } from "../../src/infrastructure/observability/diagnostics";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function completion(text: string) {
	return Response.json({
		id: "resp_test",
		object: "response",
		status: "completed",
		output: [
			{
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text, annotations: [] }],
			},
		],
	});
}

it("uses the actual OpenAI SDK with Sakana's URL and standard fugu only", async () => {
	const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => completion("こんにちは"));
	const generator = createFuguTextGenerator("test-key", fetcher, diagnostics);
	expect(await generator.generate("最初の質問")).toBe("こんにちは");
	expect(await generator.generate("次の質問")).toBe("こんにちは");
	const requests = fetcher.mock.calls.map(([url, init]) => {
		expect(String(url)).toBe("https://api.sakana.ai/v1/responses");
		expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
		return JSON.parse(String(init?.body));
	});
	for (const body of requests) {
		expect(body.model).toBe("fugu");
		expect(body.max_output_tokens).toBe(800);
		expect(body.previous_response_id).toBeUndefined();
		expect(body.tools).toBeUndefined();
	}
	expect(requests.map((body) => body.input)).toEqual(["最初の質問", "次の質問"]);
});

it.each([401, 403, 429, 500])("does not retry or leak provider errors (%i)", async (status) => {
	const output = vi.spyOn(console, "error").mockImplementation(() => {});
	const fetcher = vi
		.fn<typeof fetch>()
		.mockImplementation(async () =>
			Response.json({ error: { message: "private provider response and credential" } }, { status }),
		);
	await expect(
		createFuguTextGenerator("private-key", fetcher, diagnostics).generate("private prompt"),
	).rejects.toThrow("Fugu generation failed");
	expect(fetcher).toHaveBeenCalledOnce();
	expect(output.mock.calls).toEqual([
		[
			JSON.stringify({
				event: status === 401 || status === 403 ? "llm_auth_failed" : "llm_api_failed",
				upstreamStatus: status,
			}),
		],
	]);
});

it("rejects empty responses without logging their content", async () => {
	const output = vi.spyOn(console, "error").mockImplementation(() => {});
	const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completion(" "));
	await expect(
		createFuguTextGenerator("test-key", fetcher, diagnostics).generate("test"),
	).rejects.toThrow("Fugu generation failed");
	expect(output.mock.calls[0]).toEqual([JSON.stringify({ event: "llm_empty_response" })]);
});

it("classifies connection failures without leaking private exceptions", async () => {
	const output = vi.spyOn(console, "error").mockImplementation(() => {});
	const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private transport details"));
	await expect(
		createFuguTextGenerator("test-key", fetcher, diagnostics).generate("test"),
	).rejects.toThrow("Fugu generation failed");
	expect(fetcher).toHaveBeenCalledOnce();
	expect(JSON.stringify(output.mock.calls)).not.toContain("private");
});

it("cancels a slow generation at the configured deadline without retrying", async () => {
	const output = vi.spyOn(console, "error").mockImplementation(() => {});
	const controller = new AbortController();
	const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
	const fetcher = vi.fn<typeof fetch>().mockImplementation(
		async (_url, init) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => reject(new DOMException("aborted", "AbortError")),
					{ once: true },
				);
			}),
	);
	const result = createFuguTextGenerator("test-key", fetcher, diagnostics).generate("test");
	const rejection = expect(result).rejects.toThrow("Fugu generation failed");
	await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
	controller.abort();
	await rejection;
	expect(timeout).toHaveBeenCalledWith(120_000);
	expect(fetcher).toHaveBeenCalledOnce();
	expect(output.mock.calls).toEqual([[JSON.stringify({ event: "llm_timeout" })]]);
});
