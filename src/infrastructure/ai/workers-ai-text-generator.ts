import { z } from "zod";
import type { Diagnostics } from "../../application/ports/diagnostics";
import type { TextGenerator } from "../../application/ports/text-generator";
import { AiUsageLimitError } from "../../application/ports/text-generator";

export const WORKERS_AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

const completion = z.object({
	choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })),
});

// All calls, including future summarization, must use this gateway path.
export function createWorkersAiTextGenerator(
	ai: Pick<Ai, "run">,
	gatewayId: string,
	diagnostics?: Diagnostics,
	timeoutMs = 120_000,
): TextGenerator {
	if (!gatewayId.trim()) throw new Error("Missing AI Gateway configuration");
	return {
		async generate(input) {
			const signal = AbortSignal.timeout(timeoutMs);
			try {
				const response = await ai.run(
					WORKERS_AI_MODEL,
					{
						messages: [
							{ role: "system", content: `${input.system}\n/no_think` },
							...input.messages,
						],
						max_tokens: 800,
						stream: false,
					},
					{
						returnRawResponse: true,
						signal,
						gateway: {
							id: gatewayId,
							skipCache: true,
							collectLog: false,
							requestTimeoutMs: timeoutMs,
						},
					},
				);
				if (!response.ok) {
					diagnostics?.failure(
						response.status === 429 ? "llm_rate_or_budget_limited" : "llm_api_failed",
						response.status,
					);
					if (response.status === 429) throw new AiUsageLimitError();
					throw new Error("AI request rejected");
				}
				const answer = completion.parse(await response.json()).choices[0]?.message.content?.trim();
				if (!answer) throw new Error("Empty AI response");
				return answer;
			} catch (error) {
				if (error instanceof AiUsageLimitError) throw error;
				diagnostics?.failure(signal.aborted ? "llm_timeout" : "llm_generation_failed");
				// Provider exceptions and response bodies may contain private data.
				throw new Error("Workers AI generation failed");
			}
		},
	};
}
