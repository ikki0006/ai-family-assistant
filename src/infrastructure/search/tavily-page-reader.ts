import { z } from "zod";
import { PageReadError, type WebPageReader } from "../../application/ports/web-page-reader";
import { publicPageUrl } from "./page-url";
const responseSchema = z.object({
	results: z.array(z.object({ url: z.string(), raw_content: z.string() })),
});
export function createTavilyPageReader(key: string, fetcher: typeof fetch = fetch): WebPageReader {
	return {
		async read(url) {
			if (!publicPageUrl(url)) throw new PageReadError("unsupported");
			try {
				const response = await fetcher("https://api.tavily.com/extract", {
					method: "POST",
					redirect: "manual",
					signal: AbortSignal.timeout(12_000),
					headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
					body: JSON.stringify({
						urls: [url],
						extract_depth: "basic",
						format: "text",
						include_images: false,
						timeout: 10,
					}),
				});
				if (!response.ok)
					throw new PageReadError(
						response.status === 401 || response.status === 403
							? "auth"
							: [402, 429].includes(response.status)
								? "limited"
								: "upstream",
						response.status,
					);

				const parsed = responseSchema.safeParse(await response.json());
				if (!parsed.success) throw new PageReadError("invalid_response");
				const page = parsed.data.results[0];
				if (!page?.raw_content.trim()) throw new PageReadError("empty");
				if (!publicPageUrl(page.url)) throw new PageReadError("unsupported");
				return { url: page.url, content: page.raw_content.slice(0, 8000) };
			} catch (error) {
				if (error instanceof PageReadError) throw error;
				throw new PageReadError(
					error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
						? "timeout"
						: error instanceof SyntaxError
							? "invalid_response"
							: "transport",
				);
			}
		},
	};
}
