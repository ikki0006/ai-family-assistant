import { afterEach, expect, it, vi } from "vitest";
import {
	GEMINI_MODEL,
	createGeminiTextGenerator,
} from "../../src/infrastructure/ai/gemini-text-generator";
import { diagnostics } from "../../src/infrastructure/observability/diagnostics";

afterEach(() => vi.restoreAllMocks());

function binding(response: Response) {
	const run = vi.fn().mockResolvedValue(response);
	return { run, ai: { gateway: () => ({ run }) } as unknown as Ai };
}

it("always routes inference through the budget gateway with no logs, cache, retry or fallback", async () => {
	const { run, ai } = binding(
		Response.json({
			candidates: [{ finishReason: "STOP", content: { parts: [{ text: "こんにちは" }] } }],
		}),
	);
	expect(
		await createGeminiTextGenerator(ai, "family").generate({
			system: "test",
			messages: [{ role: "user", content: "質問" }],
		}),
	).toBe("こんにちは");
	expect(run).toHaveBeenCalledExactlyOnceWith(
		{
			provider: "google-ai-studio",
			endpoint: `v1beta/models/${GEMINI_MODEL}:generateContent`,
			headers: { "Content-Type": "application/json", "cf-aig-byok-alias": "default" },
			query: {
				systemInstruction: { parts: [{ text: "test" }] },
				contents: [{ role: "user", parts: [{ text: "質問" }] }],
				generationConfig: {
					maxOutputTokens: 2048,
					thinkingConfig: { thinkingLevel: "low", includeThoughts: false },
				},
			},
		},
		expect.objectContaining({
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
	expect(() => createGeminiTextGenerator(ai, " ")).toThrow("Missing AI Gateway");
	expect(run).not.toHaveBeenCalled();
});

it.each([401, 402, 403, 429, 500])(
	"stops on HTTP %i without leaking errors or retrying",
	async (status) => {
		const output = vi.spyOn(console, "error").mockImplementation(() => {});
		const { ai, run } = binding(new Response("private provider detail", { status }));
		await expect(
			createGeminiTextGenerator(ai, "family", diagnostics).generate({
				system: "test",
				messages: [{ role: "user", content: "private input" }],
			}),
		).rejects.toThrow(
			[402, 429].includes(status) ? "AI usage limit reached" : "Gemini generation failed",
		);
		expect(run).toHaveBeenCalledOnce();
		expect(JSON.stringify(output.mock.calls)).not.toContain("private");
		if ([402, 429].includes(status))
			expect(JSON.stringify(output.mock.calls)).toContain("llm_rate_or_budget_limited");
	},
);

it.each([
	{},
	{ candidates: [] },
	{ candidates: [{ finishReason: "STOP", content: { parts: [{ text: " " }] } }] },
	{
		candidates: [
			{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "partial private answer" }] } },
		],
	},
	{ candidates: [{ finishReason: "SAFETY" }] },
])("rejects malformed or empty output", async (body) => {
	const { ai } = binding(Response.json(body));
	await expect(
		createGeminiTextGenerator(ai, "family").generate({
			system: "test",
			messages: [{ role: "user", content: "test" }],
		}),
	).rejects.toThrow("Gemini generation failed");
});

it("passes a 120 second cancellation signal into the provider", async () => {
	const controller = new AbortController();
	const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
	const run = vi.fn().mockImplementation(
		async (_input, options) =>
			new Promise((_resolve, reject) => {
				options.signal.addEventListener("abort", () => reject(new Error("private detail")), {
					once: true,
				});
			}),
	);
	const promise = createGeminiTextGenerator(
		{ gateway: () => ({ run }) } as unknown as Ai,
		"family",
	).generate({
		system: "test",
		messages: [{ role: "user", content: "test" }],
	});
	const result = expect(promise).rejects.toThrow("Gemini generation failed");
	controller.abort();
	await result;
	expect(timeout).toHaveBeenCalledWith(120_000);
	expect(run).toHaveBeenCalledOnce();
});

it("maps assistant history to Gemini model turns and excludes thought parts", async () => {
	const { run, ai } = binding(
		Response.json({
			candidates: [
				{
					finishReason: "STOP",
					content: {
						parts: [{ text: "private thought", thought: true }, { text: "回答" }, { text: "です" }],
					},
				},
			],
		}),
	);
	const result = await createGeminiTextGenerator(ai, "family").generate({
		system: "rules",
		messages: [
			{ role: "assistant", content: "past" },
			{ role: "user", content: "question" },
		],
	});
	expect(result).toBe("回答です");
	expect(run.mock.calls[0]?.[0].query.contents).toEqual([
		{ role: "model", parts: [{ text: "past" }] },
		{ role: "user", parts: [{ text: "question" }] },
	]);
	expect(JSON.stringify(run.mock.calls)).not.toContain("/no_think");
});
