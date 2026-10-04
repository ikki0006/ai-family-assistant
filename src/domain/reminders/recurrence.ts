export type Schedule = {
	kind: "once" | "daily" | "weekly";
	at: number;
};
export type Reminder = {
	id: string;
	group_id: string;
	title: string;
	kind: Schedule["kind"];
	anchor_at: number;
	next_at: number;
	status: "active" | "paused" | "done" | "deleted";
	version: number;
	last_event: string;
};
export function nextOccurrence(schedule: Schedule, after: number): number | null {
	if (schedule.at > after) return schedule.at;
	if (schedule.kind === "once") return null;
	const interval = (schedule.kind === "daily" ? 1 : 7) * 86400000;
	return schedule.at + (Math.floor((after - schedule.at) / interval) + 1) * interval;
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
