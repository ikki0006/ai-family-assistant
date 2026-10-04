import { expect, it, vi } from "vitest";
import type { GarbageSchedule } from "../../src/application/ports/garbage-schedule";
import {
	planGarbageReminder,
	sendGarbageReminder,
} from "../../src/application/reminder/garbage-reminder";
import { garbageScheduleSchema } from "../../src/infrastructure/persistence/d1/garbage-schedule";

// Fictional schedule; never replace fixtures with a household's real schedule.
const schedule: GarbageSchedule = {
	validFrom: "2026-01-01",
	validThrough: "2027-03-31",
	rules: [
		{ label: "品目A", weekday: 2 },
		{ label: "品目B", weekday: 6, weeks: [2, 4] },
	],
	overrides: {},
};
const at = (value: string) => Date.parse(value);

it("plans tomorrow at 23 JST and today at 08 JST with different delivery IDs", () => {
	const night = planGarbageReminder(schedule, at("2026-10-05T14:00:00Z"));
	const morning = planGarbageReminder(schedule, at("2026-10-05T23:00:00Z"));
	expect(night?.text).toContain("明日（10/6）");
	expect(morning?.text).toContain("今日（10/6）");
	expect(night?.text).toContain("品目A");
	expect(night?.key).not.toBe(morning?.key);
	expect(planGarbageReminder(schedule, at("2026-10-05T14:05:00Z"))?.key).toBe(night?.key);
});

it("handles month and year rollover in Japan time", () => {
	const value = {
		...schedule,
		overrides: { "2026-11-01": ["特別品目"], "2027-01-01": ["確認済み臨時品目"] },
	};
	expect(planGarbageReminder(value, at("2026-10-31T14:00:00Z"))?.text).toContain("明日（11/1）");
	expect(planGarbageReminder(value, at("2026-12-31T14:00:00Z"))?.text).toContain(
		"確認済み臨時品目",
	);
});

it("uses nth weekday, including skipping a fifth occurrence", () => {
	for (const day of [10, 24])
		expect(
			planGarbageReminder(schedule, at(`2026-10-${String(day - 1).padStart(2, "0")}T23:00:00Z`))
				?.text,
		).toContain("品目B");
	for (const date of ["2026-10-02", "2026-10-16", "2026-10-30"])
		expect(planGarbageReminder(schedule, at(`${date}T23:00:00Z`))).toBeNull();
});

it("date overrides replace normal rules and an empty override cancels collection", () => {
	expect(
		planGarbageReminder(
			{ ...schedule, overrides: { "2026-10-06": ["振替品目"] } },
			at("2026-10-05T14:00:00Z"),
		)?.text,
	).not.toContain("品目A");
	expect(
		planGarbageReminder(
			{ ...schedule, overrides: { "2026-10-06": [] } },
			at("2026-10-05T14:00:00Z"),
		),
	).toBeNull();
});

it("does not guess unconfirmed holiday schedules, out of season schedules, or unrelated times", () => {
	expect(planGarbageReminder(schedule, at("2026-12-30T14:00:00Z"))?.text).toContain("未確認");
	for (const date of ["2027-04-01T14:00:00Z", "2026-10-05T13:00:00Z", "2026-10-05T14:15:00Z"])
		expect(planGarbageReminder(schedule, at(date))).toBeNull();
});

it("records delivery only after success and retries failures with the same key", async () => {
	const time = at("2026-10-05T14:00:00Z");
	let sent = false;
	const markSent = vi.fn(async () => {
		sent = true;
	});
	const push = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
	const dependencies = {
		store: { load: async () => schedule },
		ledger: { wasSent: async () => sent, markSent },
		sender: { push },
		groupId: "test-group",
	};
	await expect(sendGarbageReminder(dependencies, time, time)).rejects.toThrow("offline");
	expect(markSent).not.toHaveBeenCalled();
	await sendGarbageReminder(dependencies, time + 5 * 60_000, time + 5 * 60_000);
	await sendGarbageReminder(dependencies, time + 10 * 60_000, time + 10 * 60_000);
	expect(push).toHaveBeenCalledTimes(2);
	expect(push.mock.calls[0]?.[2]).toBe(push.mock.calls[1]?.[2]);
	expect(markSent).toHaveBeenCalledOnce();
});

it("ignores late cron invocations", async () => {
	const load = vi.fn();
	await sendGarbageReminder(
		{
			store: { load },
			ledger: { wasSent: vi.fn(), markSent: vi.fn() },
			sender: { push: vi.fn() },
			groupId: "test",
		},
		0,
		16 * 60_000,
	);
	expect(load).not.toHaveBeenCalled();
});

it("rejects malformed database configuration", () => {
	for (const value of [
		{ ...schedule, validFrom: "2026-02-30" },
		{ ...schedule, rules: [{ label: "A", weekday: 7 }] },
		{ ...schedule, validThrough: "2025-01-01" },
	])
		expect(garbageScheduleSchema.safeParse(value).success).toBe(false);
});
