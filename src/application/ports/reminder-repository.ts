import type { Reminder, Schedule } from "../../domain/reminders/recurrence";
export interface ReminderRepository {
	list(group: string): Promise<Reminder[]>;
	get(group: string, id: string): Promise<Reminder | null>;
	create(group: string, event: string, title: string, schedule: Schedule): Promise<Reminder>;
	change(group: string, event: string, previous: Reminder, next: Reminder): Promise<boolean>;
	due(group: string, now: number): Promise<Reminder[]>;
	finish(reminder: Reminder, key: string, now: number, next: number | null): Promise<void>;
	wasSent(key: string): Promise<boolean>;
}
export type ReminderJob = {
	type: "reminder";
	groupId: string;
	id: string;
	version: number;
	at: number;
};
