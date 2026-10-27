import type { SourceRepository } from "../../application/ports/source-repository";

const ROOT = "https://api.github.com/repos/ikki0006/ai-family-assistant";
const SHA = /^[a-f0-9]{40}$/;
const permitted = (path: string) =>
	/^(src|tests)\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.ts$/.test(path) ||
	/^docs\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.md$/.test(path) ||
	path === "README.md";

async function boundedText(response: Response, limit: number): Promise<string> {
	if (!response.ok || !response.body) throw new Error("Repository read failed");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let text = "";
	let bytes = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > limit) throw new Error("Repository response too large");
			text += decoder.decode(chunk.value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		await reader.cancel();
	}
}

export function createSourceRepository(fetcher: typeof fetch = fetch): SourceRepository {
	async function get(path: string, raw = false, limit = 250_000) {
		const response = await fetcher(`${ROOT}/${path}`, {
			method: "GET",
			redirect: "manual",
			headers: {
				Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
				"User-Agent": "ai-family-assistant",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			signal: AbortSignal.timeout(8000),
		});
		return boundedText(response, limit);
	}
	return {
		async manifest() {
			const commit = JSON.parse(await get("commits/main"));
			if (!SHA.test(commit.sha)) throw new Error("Invalid repository revision");
			const tree = JSON.parse(await get(`git/trees/${commit.sha}?recursive=1`));
			if (tree.truncated || !Array.isArray(tree.tree))
				throw new Error("Incomplete repository tree");
			const paths: string[] = tree.tree
				.filter(
					(entry: { type: string; mode: string; path: string }) =>
						entry.type === "blob" &&
						entry.mode === "100644" &&
						typeof entry.path === "string" &&
						permitted(entry.path),
				)
				.map((entry: { path: string }) => entry.path);
			if (paths.length > 1000) throw new Error("Repository tree too large");
			return { revision: commit.sha, paths };
		},
		async read(revision, paths) {
			if (
				!SHA.test(revision) ||
				paths.length < 1 ||
				paths.length > 4 ||
				new Set(paths).size !== paths.length ||
				paths.some((path) => !permitted(path))
			)
				throw new Error("Invalid repository selection");
			const files = [];
			let size = 0;
			for (const path of paths) {
				const content = await get(`contents/${path}?ref=${revision}`, true, 60_000);
				size += content.length;
				if (size > 60_000) throw new Error("Selected sources too large");
				files.push({ path, content });
			}
			return files;
		},
	};
}
