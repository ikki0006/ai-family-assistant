import { expect, it, vi } from "vitest";
import { answerWithSearch } from "../../src/application/conversation/answer-with-search";
import { createTavilyWebSearch } from "../../src/infrastructure/search/tavily-web-search";
const input = {
	system: "rules",
	messages: [{ role: "user" as const, content: "施設の営業時間を調べて" }],
};
it("skips search and quota for ordinary conversation", async () => {
	const generate = vi.fn().mockResolvedValueOnce('{"query":null}').mockResolvedValueOnce("回答");
	const search = vi.fn();
	const reserve = vi.fn();
	expect(await answerWithSearch(input, { generate }, { search }, reserve, 0)).toBe("回答");
	expect(search).not.toHaveBeenCalled();
	expect(reserve).not.toHaveBeenCalled();
});
it("searches once, attaches actual source URLs, and leaves original context untouched", async () => {
	const generate = vi
		.fn()
		.mockResolvedValueOnce('{"query":"施設 営業時間"}')
		.mockResolvedValueOnce("営業は9時からです。");
	const search = vi
		.fn()
		.mockResolvedValue([{ title: "公式", url: "https://example.com/hours", content: "9時から" }]);
	const reserve = vi.fn().mockResolvedValue(true);
	const answer = await answerWithSearch(input, { generate }, { search }, reserve, 0);
	expect(answer).toContain("https://example.com/hours");
	expect(answer).toContain("1970-01-01");
	expect(search).toHaveBeenCalledExactlyOnceWith("施設 営業時間");
	expect(reserve).toHaveBeenCalledOnce();
	expect(input.messages).toHaveLength(1);
});
it("does not call search when the budget is exhausted", async () => {
	const search = vi.fn();
	const generate = vi.fn().mockResolvedValue('{"query":"test"}');
	expect(await answerWithSearch(input, { generate }, { search }, async () => false, 0)).toContain(
		"上限",
	);
	expect(search).not.toHaveBeenCalled();
	expect(generate).toHaveBeenCalledOnce();
});
it("does not invent a current answer on search failure", async () => {
	const generate = vi.fn().mockResolvedValue('{"query":"test"}');
	const search = vi.fn().mockRejectedValue(new Error("secret"));
	const answer = await answerWithSearch(input, { generate }, { search }, async () => true, 0);
	expect(answer).toContain("検索に失敗");
	expect(answer).not.toContain("secret");
	expect(generate).toHaveBeenCalledOnce();
});
it("uses Basic search without auto-upgrades and rejects unsafe URLs", async () => {
	const fetcher = vi.fn().mockResolvedValue(
		Response.json({
			results: [
				{ title: "ok", url: "https://example.com", content: "x".repeat(2000) },
				{ title: "bad", url: "javascript:alert(1)", content: "bad" },
			],
		}),
	);
	const result = await createTavilyWebSearch("test-key", fetcher).search("query");
	expect(result).toHaveLength(1);
	expect(result[0]?.content).toHaveLength(1200);
	expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toMatchObject({
		search_depth: "basic",
		auto_parameters: false,
		max_results: 5,
	});
});
it("never exposes provider error content", async () => {
	const fetcher = vi.fn().mockResolvedValue(new Response("private-key", { status: 401 }));
	await expect(createTavilyWebSearch("test", fetcher).search("query")).rejects.toThrow(
		"Web search failed",
	);
});
