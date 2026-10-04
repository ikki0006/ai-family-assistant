import type { ImprovementDispatcher } from "../../application/ports/improvement-repository";

export function createImprovementDispatcher(
	token: string,
	fetcher: typeof fetch = fetch,
): ImprovementDispatcher {
	return {
		async dispatch(request) {
			const response = await fetcher(
				"https://api.github.com/repos/ikki0006/ai-family-assistant/actions/workflows/improvement.yml/dispatches",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: "application/vnd.github+json",
						"Content-Type": "application/json",
						"X-GitHub-Api-Version": "2022-11-28",
						"User-Agent": "ai-family-assistant",
					},
					body: JSON.stringify({
						ref: "main",
						inputs: {
							request_id: request.id,
							specification: request.specification,
							version: String(request.version),
						},
					}),
					signal: AbortSignal.timeout(10_000),
				},
			);
			if (response.status !== 204) throw new Error("Improvement dispatch failed");
		},
	};
}
