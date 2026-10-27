import { expect, it, vi } from "vitest";
import { consultSource } from "../../src/application/improvements/consult-source";
const revision = "a".repeat(40);
const path = "src/application/prompts/reminders.ts";
const repo = () => ({
	manifest: vi.fn(async () => ({ revision, paths: [path] })),
	read: vi.fn(async () => [{ path, content: "reference source" }]),
});
const generator = (...outputs: unknown[]) => ({
	generate: vi.fn(async () => JSON.stringify(outputs.shift())),
});
it("selects only supplied paths, pins the revision and asks about missing requirements", async () => {
	const repository = repo();
	const ai = generator([path], {
		action: "clarify",
		question: "削除に失敗したら登録も止めますか？",
		choices: ["止める", "登録は進める"],
	});
	const result = await consultSource("一度に操作したい", "直近の相談", true, repository, ai);
	expect(result.action).toBe("clarify");
	expect(repository.read).toHaveBeenCalledWith(revision, [path]);
	expect(ai.generate.mock.calls).toHaveLength(2);
});
it("includes source evidence in proposals and cannot propose from read-only inspection", async () => {
	const proposed = { action: "improve", specification: "削除に失敗したら登録を止める" };
	expect(
		await consultSource("改善して", "", true, repo(), generator([path], proposed)),
	).toMatchObject({ action: "improve", specification: expect.stringContaining(revision) });
	expect(
		await consultSource("実装を教えて", "", false, repo(), generator([path], proposed)),
	).toMatchObject({
		action: "clarify",
		question: expect.stringContaining("source_consult_failed"),
	});
});
it.each([[".dev.vars"], [path, path], [], ["https://other.example/code"]])(
	"rejects unauthorized selection %j",
	async (...paths) => {
		const repository = repo();
		await consultSource("調べて", "", true, repository, generator(paths));
		expect(repository.read).not.toHaveBeenCalled();
	},
);
it("fails closed on repository failure and malformed LLM output", async () => {
	const repository = repo();
	repository.manifest.mockRejectedValueOnce(new Error("private details"));
	const result = await consultSource("調べて", "", true, repository, generator());
	expect(JSON.stringify(result)).not.toContain("private details");
	expect(result.action).toBe("clarify");
});
