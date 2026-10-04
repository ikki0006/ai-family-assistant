import type { Reminder } from "../../domain/reminders/recurrence";
import { describeRecurrence, formatJst } from "../../domain/reminders/recurrence";
import type { GarbageSchedule } from "../ports/garbage-schedule";
import { contextSize } from "./build-context";

export function scheduleContext(
	reminders: Reminder[],
	garbage: GarbageSchedule | null,
	question: string,
	now: number,
) {
	const today = formatJst(now).slice(0, 10);
	const terms = Array.from(question)
		.slice(0, -1)
		.map((c, i) => c + Array.from(question)[i + 1]);
	const score = (title: string) => terms.filter((t) => title.includes(t)).length;
	const result: {
		available: boolean;
		garbage: GarbageSchedule | null;
		reminders: { title: string; recurrence: string; next: string; status: string }[];
		truncated: boolean;
	} = {
		available: true,
		garbage: garbage ? { ...garbage, overrides: {} } : null,
		reminders: [],
		truncated: false,
	};
	// Keep collection rules ahead of optional dates and reminders. Never silently truncate.
	if (contextSize(JSON.stringify(result)) > 2200)
		return { available: true, truncated: true, garbage: null, reminders: [] };
	if (garbage && result.garbage)
		for (const [date, labels] of Object.entries(garbage.overrides).sort()) {
			if (date < today) continue;
			result.garbage.overrides[date] = labels;
			if (contextSize(JSON.stringify(result)) > 2200) {
				delete result.garbage.overrides[date];
				result.truncated = true;
			}
		}
	for (const r of [...reminders]
		.filter((r) => r.status !== "deleted")
		.sort((a, b) => score(b.title) - score(a.title) || a.next_at - b.next_at)) {
		result.reminders.push({
			title: r.title,
			recurrence: describeRecurrence(r),
			next: formatJst(r.next_at),
			status: r.status,
		});
		if (contextSize(JSON.stringify(result)) > 2200) {
			result.reminders.pop();
			result.truncated = true;
		}
	}
	return result;
}
