import { z } from "zod";
import type { WebPageReader } from "../../application/ports/web-page-reader";
import { publicPageUrl } from "./page-url";
const responseSchema = z.object({
	results: z.array(z.object({ url: z.string(), raw_content: z.string() })),
});
export function createTavilyPageReader(key: string, fetcher: typeof fetch = fetch): WebPageReader {
	return {
		async read(url) {
			if (!publicPageUrl(url)) throw new Error("Unsupported page URL");
			try {
				const response = await fetcher("https://api.tavily.com/extract", {
					method: "POST",
					redirect: "error",
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
				if (!response.ok) throw new Error();
				const page = responseSchema.parse(await response.json()).results[0];
				if (!page?.raw_content.trim() || !publicPageUrl(page.url)) throw new Error();
				return { url: page.url, content: page.raw_content.slice(0, 8000) };
			} catch {
				throw new Error("Page reading failed");
			}
		},
	};
}
