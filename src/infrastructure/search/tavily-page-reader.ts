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
				return await readPageResponse(response);
			} catch (error) {
				throw pageReadFailure(error);
			}
		},
	};
}

async function readPageResponse(response: Response) {
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
	if (!parsed.success) throw new PageReadError("invalid_response", response.status);
	const page = parsed.data.results[0];
	if (!page?.raw_content.trim()) throw new PageReadError("empty", response.status);
	if (!publicPageUrl(page.url)) throw new PageReadError("unsupported");
	return { url: page.url, content: page.raw_content.slice(0, 8000) };
}

function pageReadFailure(error: unknown): PageReadError {
	if (error instanceof PageReadError) return error;
	return new PageReadError(
		error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
			? "timeout"
			: error instanceof SyntaxError
				? "invalid_response"
				: "transport",
	);
}
