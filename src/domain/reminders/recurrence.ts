export type Recurrence = {
	kind: "once" | "daily" | "weekly" | "monthly" | "yearly";
	interval?: number | null;
	day?: number | null;
	month?: number | null;
};
export type Schedule = Recurrence & {
	at: number;
};
export type Reminder = Recurrence & {
	id: string;
	group_id: string;
	title: string;
	anchor_at: number;
	next_at: number;
	status: "active" | "paused" | "done" | "deleted";
	version: number;
	last_event: string;
};
const JST = 9 * 3600000;
function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
export function validateSchedule(schedule: Schedule): void {
	const { kind, interval = 1, day, month } = schedule;
	if (
		!["once", "daily", "weekly", "monthly", "yearly"].includes(kind) ||
		!Number.isInteger(interval) ||
		interval === null ||
		interval < 1 ||
		interval > 100
	)
		throw new Error("Invalid recurrence");
	if (kind === "once" && interval !== 1) throw new Error("Invalid interval");
	const calendar = kind === "monthly" || kind === "yearly";
	if (calendar ? !Number.isInteger(day) || day == null || day < 1 || day > 31 : day != null)
		throw new Error("Invalid recurrence day");
	if (
		kind === "yearly"
			? !Number.isInteger(month) || month == null || month < 1 || month > 12
			: month != null
	)
		throw new Error("Invalid recurrence month");
	if (kind === "yearly" && day != null && month != null && day > daysInMonth(2000, month))
		throw new Error("Impossible annual date");
	const date = new Date(schedule.at + JST);
	if (!Number.isFinite(schedule.at)) throw new Error("Invalid anchor");
	if (
		calendar &&
		(date.getUTCDate() !==
			Math.min(day ?? 1, daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1)) ||
			(kind === "yearly" && date.getUTCMonth() + 1 !== month))
	)
		throw new Error("Anchor disagrees with recurrence");
}
export function nextOccurrence(schedule: Schedule, after: number): number | null {
	validateSchedule(schedule);
	if (schedule.at > after) return schedule.at;
	if (schedule.kind === "once") return null;
	const step = schedule.interval ?? 1;
	if (schedule.kind === "daily" || schedule.kind === "weekly") {
		const interval = (schedule.kind === "daily" ? 1 : 7) * step * 86400000;
		return schedule.at + (Math.floor((after - schedule.at) / interval) + 1) * interval;
	}
	const anchor = new Date(schedule.at + JST);
	const current = new Date(after + JST);
	const stride = step * (schedule.kind === "yearly" ? 12 : 1);
	const start = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth();
	const elapsed = current.getUTCFullYear() * 12 + current.getUTCMonth() - start;
	let count = Math.max(0, Math.floor(elapsed / stride));
	for (;;) {
		const index = start + count * stride;
		const year = Math.floor(index / 12);
		const month = index % 12;
		const day = Math.min(schedule.day ?? anchor.getUTCDate(), daysInMonth(year, month + 1));
		const at = Date.UTC(year, month, day, anchor.getUTCHours(), anchor.getUTCMinutes()) - JST;
		if (at > after) return at;
		count++;
	}
}
export function describeRecurrence(r: Recurrence): string {
	const n = r.interval ?? 1;
	const units = { daily: "日", weekly: "週", monthly: "か月", yearly: "年" };
	if (r.kind === "once") return "単発";
	const base =
		n === 1
			? { daily: "毎日", weekly: "毎週", monthly: "毎月", yearly: "毎年" }[r.kind]
			: `${n}${units[r.kind]}ごと`;
	return (
		base +
		(r.kind === "yearly"
			? ` ${r.month}月${r.day}日`
			: r.kind === "monthly"
				? r.day === 31
					? " 月末（31日指定）"
					: ` ${r.day}日`
				: "")
	);
}
export function parseJst(value: unknown): number {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/.test(value))
		throw new Error("Invalid date");
	const at = Date.parse(value);
	if (
		!Number.isFinite(at) ||
		new Date(at + 9 * 3600000).toISOString().slice(0, 19) !== value.slice(0, 19)
	)
		throw new Error("Invalid date");
	return at;
}
export function formatJst(at: number): string {
	return new Date(at + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");
}
