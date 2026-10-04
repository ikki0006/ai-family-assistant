import { z } from "zod";
import type { WebSearch } from "../../application/ports/web-search";

const result = z.object({
	results: z.array(
		z.object({
			title: z.string(),
			url: z.string().url(),
			content: z.string(),
		}),
	),
});
export function createTavilyWebSearch(key: string, fetcher: typeof fetch = fetch): WebSearch {
	return {
		async search(query) {
			try {
				const response = await fetcher("https://api.tavily.com/search", {
					method: "POST",
					signal: AbortSignal.timeout(10_000),
					headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
					body: JSON.stringify({
						query,
						search_depth: "basic",
						max_results: 5,
						include_answer: false,
						include_raw_content: false,
						auto_parameters: false,
					}),
				});
				if (!response.ok) throw new Error("Rejected");
				return result
					.parse(await response.json())
					.results.filter(
						(r) => new URL(r.url).protocol === "https:" || new URL(r.url).protocol === "http:",
					)
					.slice(0, 5)
					.map((r) => ({
						title: r.title.slice(0, 150),
						url: r.url,
						content: r.content.slice(0, 1200),
					}));
			} catch {
				throw new Error("Web search failed");
			}
		},
	};
}
