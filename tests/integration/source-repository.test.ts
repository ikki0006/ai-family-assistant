import { expect, it, vi } from "vitest";
import { createSourceRepository } from "../../src/infrastructure/github/source-repository";
const revision = "a".repeat(40);
const path = "src/application/prompts/reminders.ts";
const root = "https://api.github.com/repos/ikki0006/ai-family-assistant/";
it("uses fixed read-only endpoints and pins file reads to the resolved commit in Workers", async () => {
	const requests: Request[] = [];
	const fetcher: typeof fetch = async (url, init) => {
		const request = new Request(url, init);
		requests.push(request);
		if (request.url.endsWith("commits/main")) return Response.json({ sha: revision });
		if (request.url.includes("git/trees/"))
			return Response.json({
				tree: [
					{ path, mode: "100644", type: "blob" },
					{ path: ".dev.vars", mode: "100644", type: "blob" },
					{ path: "src/link.ts", mode: "120000", type: "blob" },
				],
			});
		return new Response("source text");
	};
	const repository = createSourceRepository(fetcher);
	expect(await repository.manifest()).toEqual({ revision, paths: [path] });
	expect(await repository.read(revision, [path])).toEqual([{ path, content: "source text" }]);
	expect(requests[2]?.url).toBe(`${root}contents/${path}?ref=${revision}`);
	for (const request of requests) {
		expect(request.method).toBe("GET");
		expect(request.redirect).toBe("manual");
		expect(request.headers.has("Authorization")).toBe(false);
	}
});
it("rejects paths and revisions before network access", async () => {
	const fetcher = vi.fn();
	const repository = createSourceRepository(fetcher);
	for (const invalid of [
		".dev.vars",
		"src/../secrets.ts",
		"https://other.example/a",
		"src/%2e%2e/file.ts",
	])
		await expect(repository.read(revision, [invalid])).rejects.toThrow();
	await expect(repository.read("main", [path])).rejects.toThrow();
	await expect(repository.read(revision, [path, path])).rejects.toThrow();
	expect(fetcher).not.toHaveBeenCalled();
});
it("rejects redirects, rate limits, oversized content and truncated manifests", async () => {
	for (const status of [302, 403, 429]) {
		const repository = createSourceRepository(async () => new Response("", { status }));
		await expect(repository.manifest()).rejects.toThrow("Repository read failed");
	}
	await expect(
		createSourceRepository(async () => new Response("x".repeat(60_001))).read(revision, [path]),
	).rejects.toThrow("too large");
	let calls = 0;
	await expect(
		createSourceRepository(async () =>
			Response.json(calls++ ? { truncated: true, tree: [] } : { sha: revision }),
		).manifest(),
	).rejects.toThrow("Incomplete");
});
