import { afterEach, expect, it, vi } from "vitest";
import {
	WORKERS_AI_MODEL,
	createWorkersAiTextGenerator,
} from "../../src/infrastructure/ai/workers-ai-text-generator";
import { diagnostics } from "../../src/infrastructure/observability/diagnostics";

afterEach(() => vi.restoreAllMocks());

function binding(response: Response) {
	const run = vi.fn().mockResolvedValue(response);
	return { run, ai: { run } as unknown as Ai };
}

it("always routes inference through the budget gateway with no logs, cache, retry or fallback", async () => {
	const { run, ai } = binding(Response.json({ choices: [{ message: { content: "こんにちは" } }] }));
	expect(
		await createWorkersAiTextGenerator(ai, "family").generate({
			system: "test",
			messages: [{ role: "user", content: "質問" }],
		}),
	).toBe("こんにちは");
	expect(run).toHaveBeenCalledExactlyOnceWith(
		WORKERS_AI_MODEL,
		expect.objectContaining({ max_tokens: 800, stream: false }),
		expect.objectContaining({
			returnRawResponse: true,
			signal: expect.any(AbortSignal),
			gateway: {
				id: "family",
				skipCache: true,
				collectLog: false,
				requestTimeoutMs: 120_000,
			},
		}),
	);
});

it("refuses missing gateway configuration instead of bypassing budget controls", () => {
	const { ai, run } = binding(Response.json({}));
	expect(() => createWorkersAiTextGenerator(ai, " ")).toThrow("Missing AI Gateway");
	expect(run).not.toHaveBeenCalled();
});

it.each([401, 403, 429, 500])(
	"stops on HTTP %i without leaking errors or retrying",
	async (status) => {
		const output = vi.spyOn(console, "error").mockImplementation(() => {});
		const { ai, run } = binding(new Response("private provider detail", { status }));
		await expect(
			createWorkersAiTextGenerator(ai, "family", diagnostics).generate({
				system: "test",
				messages: [{ role: "user", content: "private input" }],
			}),
		).rejects.toThrow(status === 429 ? "AI usage limit reached" : "Workers AI generation failed");
		expect(run).toHaveBeenCalledOnce();
		expect(JSON.stringify(output.mock.calls)).not.toContain("private");
		if (status === 429)
			expect(JSON.stringify(output.mock.calls)).toContain("llm_rate_or_budget_limited");
	},
);

it.each([{}, { choices: [] }, { choices: [{ message: { content: " " } }] }])(
	"rejects malformed or empty output",
	async (body) => {
		const { ai } = binding(Response.json(body));
		await expect(
			createWorkersAiTextGenerator(ai, "family").generate({
				system: "test",
				messages: [{ role: "user", content: "test" }],
			}),
		).rejects.toThrow("Workers AI generation failed");
	},
);

it("passes a 120 second cancellation signal into the provider", async () => {
	const controller = new AbortController();
	const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
	const run = vi.fn().mockImplementation(
		async (_model, _input, options) =>
			new Promise((_resolve, reject) => {
				options.signal.addEventListener("abort", () => reject(new Error("private detail")), {
					once: true,
				});
			}),
	);
	const promise = createWorkersAiTextGenerator({ run } as unknown as Ai, "family").generate({
		system: "test",
		messages: [{ role: "user", content: "test" }],
	});
	const result = expect(promise).rejects.toThrow("Workers AI generation failed");
	controller.abort();
	await result;
	expect(timeout).toHaveBeenCalledWith(120_000);
	expect(run).toHaveBeenCalledOnce();
});
