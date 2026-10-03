import OpenAI from "openai";
import type { Diagnostics } from "../../application/ports/diagnostics";
import type { TextGenerator } from "../../application/ports/text-generator";

export function createFuguTextGenerator(
	apiKey: string,
	fetcher: typeof fetch = fetch,
	diagnostics?: Diagnostics,
): TextGenerator {
	const client = new OpenAI({
		apiKey,
		baseURL: "https://api.sakana.ai/v1",
		fetch: fetcher,
		timeout: 120_000,
		maxRetries: 0,
		logLevel: "off",
	});
	return {
		async generate(text) {
			try {
				const response = await client.responses.create(
					{
						model: "fugu",
						instructions:
							"あなたは家族用のアシスタントです。日本語で簡潔に答えてください。過去の会話や記憶にはアクセスできません。実行していない操作や保存を完了したとは言わないでください。",
						input: text,
						max_output_tokens: 800,
					},
					{ signal: AbortSignal.timeout(120_000) },
				);
				const answer = response.output_text?.trim();
				if (!answer) {
					diagnostics?.failure("llm_empty_response");
					throw new Error("Empty Fugu response");
				}
				return answer;
			} catch (error) {
				if (
					error instanceof OpenAI.APIConnectionTimeoutError ||
					error instanceof OpenAI.APIUserAbortError
				) {
					diagnostics?.failure("llm_timeout");
				} else if (error instanceof OpenAI.APIError) {
					diagnostics?.failure(
						error.status === 401 || error.status === 403 ? "llm_auth_failed" : "llm_api_failed",
						error.status,
					);
				} else {
					diagnostics?.failure("llm_generation_failed");
				}
				// SDK errors may contain requests, provider bodies, or credentials.
				throw new Error("Fugu generation failed");
			}
		},
	};
}
