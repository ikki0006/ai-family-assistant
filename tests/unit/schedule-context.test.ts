import { expect, it } from "vitest";
import { contextSize } from "../../src/application/conversation/build-context";
import { scheduleContext } from "../../src/application/conversation/schedule-context";
import { parseReminderAction } from "../../src/application/reminders/manage-reminders";
it("provides stored collection rules and overrides without household identifiers", () => {
	const garbage = {
		validFrom: "2026-01-01",
		validThrough: "2026-12-31",
		rules: [{ label: "不燃ごみ", weekday: 2, weeks: [1, 3] }],
		overrides: { "2026-11-03": [] },
	};
	const result = scheduleContext([], garbage, "不燃はいつ？", Date.parse("2026-10-04"));
	expect(result.garbage).toEqual(garbage);
	expect(result.truncated).toBe(false);
	expect(parseReminderAction('{"action":"inspect"}').action).toBe("inspect");
});
it("marks partial tool results rather than implying missing registrations", () => {
	const result = scheduleContext(
		Array.from({ length: 100 }, (_, i) => ({
			id: String(i),
			group_id: "private-group",
			title: "確認する時間ですよ。".repeat(10),
			kind: "once" as const,
			anchor_at: 0,
			next_at: i,
			status: "active" as const,
			version: 1,
			last_event: "private-event",
		})),
		null,
		"予定",
		Date.now(),
	);
	expect(result.truncated).toBe(true);
	expect(contextSize(JSON.stringify(result))).toBeLessThanOrEqual(2200);
	expect(JSON.stringify(result)).not.toContain("private-");
});
