import { z } from "zod";
import type { Diagnostics } from "../../application/ports/diagnostics";
import type { TextGenerator } from "../../application/ports/text-generator";
import { AiUsageLimitError } from "../../application/ports/text-generator";

export const GEMINI_MODEL = "gemini-3.8-flash";

const completion = z.object({
	candidates: z
		.array(
			z.object({
				finishReason: z.literal("STOP"),
				content: z.object({
					parts: z.array(
						z.object({ text: z.string().optional(), thought: z.boolean().optional() }),
					),
				}),
			}),
		)
		.min(1),
});

// All calls, including future summarization, must use this gateway path.
export function createGeminiTextGenerator(
	ai: Pick<Ai, "gateway">,
	gatewayId: string,
	diagnostics?: Diagnostics,
	timeoutMs = 120_000,
): TextGenerator {
	if (!gatewayId.trim()) throw new Error("Missing AI Gateway configuration");
	return {
		async generate(input) {
			const signal = AbortSignal.timeout(timeoutMs);
			try {
				const response = await ai.gateway(gatewayId).run(
					{
						provider: "google-ai-studio",
						endpoint: `v1beta/models/${GEMINI_MODEL}:generateContent`,
						headers: { "Content-Type": "application/json", "cf-aig-byok-alias": "default" },
						query: {
							systemInstruction: { parts: [{ text: input.system }] },
							contents: input.messages.map((message) => ({
								role: message.role === "assistant" ? "model" : "user",
								parts: [
									{ text: message.content },
									...(message.image
										? [
												{
													inlineData: {
														mimeType: message.image.mimeType,
														data: message.image.data,
													},
												},
											]
										: []),
								],
							})),
							generationConfig: {
								maxOutputTokens: 2048,
								thinkingConfig: { thinkingLevel: "low", includeThoughts: false },
							},
						},
					},
					{
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
						[402, 429].includes(response.status) ? "llm_rate_or_budget_limited" : "llm_api_failed",
						response.status,
					);
					if ([402, 429].includes(response.status)) throw new AiUsageLimitError();
					throw new Error("AI request rejected");
				}
				const answer = completion
					.parse(await response.json())
					.candidates[0]?.content.parts.filter((part) => !part.thought)
					.map((part) => part.text ?? "")
					.join("")
					.trim();
				if (!answer) throw new Error("Empty AI response");
				return answer;
			} catch (error) {
				if (error instanceof AiUsageLimitError) throw error;
				diagnostics?.failure(signal.aborted ? "llm_timeout" : "llm_generation_failed");
				// Provider exceptions and response bodies may contain private data.
				throw new Error("Gemini generation failed");
			}
		},
	};
}
