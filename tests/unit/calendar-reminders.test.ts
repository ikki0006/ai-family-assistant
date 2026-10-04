import { expect, it } from "vitest";
import { nextOccurrence, parseJst, validateSchedule } from "../../src/domain/reminders/recurrence";
const at = (day: string) => parseJst(`${day}T08:00:00+09:00`);
it("clamps month ends without drifting and skips missed months", () => {
	const schedule = { kind: "monthly" as const, at: at("2027-01-31"), day: 31 };
	expect(nextOccurrence(schedule, schedule.at)).toBe(at("2027-02-28"));
	expect(nextOccurrence(schedule, at("2027-02-28"))).toBe(at("2027-03-31"));
	expect(nextOccurrence(schedule, at("2028-02-01"))).toBe(at("2028-02-29"));
	expect(nextOccurrence({ ...schedule, at: at("2027-02-28") }, at("2027-02-28"))).toBe(
		at("2027-03-31"),
	);
});
it("preserves annual leap day, JST clock, and year rollover", () => {
	const schedule = { kind: "yearly" as const, at: at("2026-02-28"), month: 2, day: 29 };
	expect(nextOccurrence(schedule, schedule.at)).toBe(at("2027-02-28"));
	expect(nextOccurrence(schedule, at("2027-03-01"))).toBe(at("2028-02-29"));
	expect(nextOccurrence({ kind: "monthly", at: at("2026-12-31"), day: 31 }, at("2026-12-31"))).toBe(
		at("2027-01-31"),
	);
});
it("keeps interval phase and strictly future occurrences", () => {
	for (const [kind, interval, anchor, after, expected, fields] of [
		["daily", 3, "2026-10-01", "2026-10-04", "2026-10-07", {}],
		["weekly", 2, "2026-10-01", "2026-10-20", "2026-10-29", {}],
		["monthly", 3, "2026-01-31", "2026-05-01", "2026-07-31", { day: 31 }],
		["yearly", 2, "2026-02-28", "2026-03-01", "2028-02-29", { day: 29, month: 2 }],
	] as const)
		expect(nextOccurrence({ kind, interval, at: at(anchor), ...fields }, at(after))).toBe(
			at(expected),
		);
	expect(nextOccurrence({ kind: "weekly", at: at("2026-10-08") }, at("2026-10-01"))).toBe(
		at("2026-10-08"),
	);
});
it("rejects impossible, contradictory and malformed recurrence fields", () => {
	for (const schedule of [
		{ kind: "monthly" as const, day: 31, at: at("2026-10-30") },
		{ kind: "yearly" as const, day: 31, month: 4, at: at("2026-04-30") },
		{ kind: "yearly" as const, day: 29, month: 2, at: at("2026-03-29") },
		{ kind: "monthly" as const, at: at("2026-10-01") },
		{ kind: "daily" as const, day: 1, at: at("2026-10-01") },
		...[0, -1, 1.5, 101, Number.NaN].map((interval) => ({
			kind: "weekly" as const,
			interval,
			at: at("2026-10-01"),
		})),
	])
		expect(() => validateSchedule(schedule)).toThrow();
});
