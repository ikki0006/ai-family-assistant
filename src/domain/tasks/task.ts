import { type Schedule, nextOccurrence } from "../reminders/recurrence";
export type TaskMember = { speaker: string; name: string };
export type TaskOccurrence = { id: string; dueAt: number; speaker: string; doneAt: number | null };
export type FamilyTask = {
	id: string;
	title: string;
	schedule: Schedule;
	members: TaskMember[];
	status: "active" | "paused";
	nextAt: number | null;
	occurrences: TaskOccurrence[];
	notifiedDay: number | null;
};
export type TaskState = { version: number; tasks: FamilyTask[] };
export function addOccurrence(task: FamilyTask, at: number) {
	for (const member of task.members) {
		const id = `${task.id}:${at}:${member.speaker}`;
		if (!task.occurrences.some((o) => o.id === id))
			task.occurrences.push({ id, dueAt: at, speaker: member.speaker, doneAt: null });
	}
}
// Completion belongs to one person and one period, never to the recurring definition.
export function advanceTask(task: FamilyTask, now: number) {
	if (task.status !== "active") return;
	task.occurrences = task.occurrences.filter(
		(o) => o.doneAt === null || o.doneAt > now - 90 * 86400000,
	);
	for (let count = 0; task.nextAt !== null && task.nextAt <= now && count < 30; count++) {
		if (task.occurrences.length + task.members.length > 1000) break;
		const at = task.nextAt;
		addOccurrence(task, at);
		task.nextAt = nextOccurrence(task.schedule, at);
	}
}
export function notificationSlot(task: FamilyTask, now: number): number {
	const day = 86400000;
	return task.schedule.at + Math.floor((now - task.schedule.at) / day) * day;
}
export function pendingTasks(task: FamilyTask, now: number) {
	return task.occurrences.filter((o) => o.doneAt === null && o.dueAt <= now);
}
