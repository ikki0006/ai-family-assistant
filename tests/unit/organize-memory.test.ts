import { expect, it } from "vitest";
import { buildContext, contextSize } from "../../src/application/conversation/build-context";
import type { MemoryBatch } from "../../src/application/conversation/conversation";
import {
	memoryCommand,
	memoryInventory,
	scheduleInventory,
} from "../../src/application/memory/memory-commands";
import { organizeMemory } from "../../src/application/memory/organize-memory";
const now = Date.parse("2026-10-04T03:00:00Z");
const batch: MemoryBatch = {
	day: "2026-10-04",
	epoch: 0,
	revision: 0,
	previousSummary: "",
	messages: [
		{
			id: "u1",
			role: "user",
			text: "いつも夕食は19時です",
			speaker: "person-a",
			occurredAt: now,
			day: "2026-10-04",
		},
		{
			id: "a1",
			role: "assistant",
			text: "推測",
			speaker: "assistant",
			occurredAt: now + 1,
			day: "2026-10-04",
		},
	],
};
const update = {
	subject: "person-a",
	key: "dinner-time",
	text: "普段の夕食は19時",
	sourceIds: ["u1"],
	expiresAt: null,
};
function generator(updates: unknown[], retire: unknown[] = []) {
	return {
		generate: async () =>
			JSON.stringify({ summary: "夕食の時刻について話した。", updates, retire }),
	};
}
it("extracts grounded facts and rejects bot-only, invented or mismatched sources", async () => {
	expect((await organizeMemory(batch, [], generator([update]), now)).updates).toEqual([update]);
	for (const invalid of [
		{ ...update, sourceIds: ["a1"] },
		{ ...update, sourceIds: ["missing"] },
		{ ...update, subject: "other-person" },
		{ ...update, expiresAt: now - 1 },
	])
		await expect(organizeMemory(batch, [], generator([invalid]), now)).rejects.toThrow();
	await expect(
		organizeMemory(batch, [], generator([], [{ id: "missing", sourceIds: ["u1"] }]), now),
	).rejects.toThrow();
});
it("handles inventory and explicit memory commands without model interpretation", () => {
	expect(memoryCommand("何を覚えてる？")).toEqual({ type: "list", page: 1 });
	expect(memoryCommand("覚えて: 猫が好き")).toEqual({ type: "remember", text: "猫が好き" });
	expect(memoryCommand("予定一覧 2")).toEqual({ type: "schedules", page: 2 });
	expect(memoryInventory([], 1)).toContain("長期記憶：0件");
	const text = scheduleInventory(
		[
			{
				id: "r",
				group_id: "g",
				title: "架空の通知",
				kind: "daily",
				anchor_at: now,
				next_at: now,
				status: "paused",
				version: 1,
				last_event: "e",
			},
		],
		{
			validFrom: "2026-01-01",
			validThrough: "2026-12-31",
			rules: [{ label: "資源", weekday: 1 }],
			overrides: { "2026-10-05": [] },
		},
		1,
		now,
	);
	expect(text).toContain("停止中");
	expect(text).toContain("前日23時／当日8時");
	expect(text).toContain("月曜日");
	expect(text).toContain("収集なし");
});
it("keeps long-term facts inside the bounded answer context", () => {
	const context = buildContext(
		{ epoch: 0, revision: 0, messages: batch.messages, summaries: [] },
		now,
		JSON.stringify({ facts: [update.text] }),
	);
	expect(JSON.stringify(context)).toContain(update.text);
	expect(
		contextSize(context.system) +
			context.messages.reduce((n, m) => n + contextSize(m.content) + 32, 0),
	).toBeLessThanOrEqual(8000);
});
