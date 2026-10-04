import type { ReminderRepository } from "../../../application/ports/reminder-repository";
import type { Reminder } from "../../../domain/reminders/recurrence";
export function createReminderRepository(db: D1Database): ReminderRepository {
	return {
		async list(group) {
			return (
				await db
					.prepare(
						"SELECT * FROM reminders WHERE group_id=? AND status!='deleted' ORDER BY next_at LIMIT 100",
					)
					.bind(group)
					.all<Reminder>()
			).results;
		},
		async get(group, id) {
			return db
				.prepare("SELECT * FROM reminders WHERE group_id=? AND id=?")
				.bind(group, id)
				.first<Reminder>();
		},
		async create(group, event, title, schedule) {
			await db
				.prepare(
					"INSERT OR IGNORE INTO reminders (id,group_id,title,kind,anchor_at,next_at,status,version,last_event,interval,day,month) VALUES (?,?,?,?,?,?,'active',1,?,?,?,?)",
				)
				.bind(
					event,
					group,
					title,
					schedule.kind,
					schedule.at,
					schedule.at,
					event,
					schedule.interval ?? 1,
					schedule.day ?? null,
					schedule.month ?? null,
				)
				.run();
			const result = await this.get(group, event);
			if (!result) throw new Error("Reminder creation failed");
			return result;
		},
		async change(group, event, previous, next) {
			const result = await db
				.prepare(
					"UPDATE reminders SET title=?,kind=?,interval=?,day=?,month=?,anchor_at=?,next_at=?,status=?,version=version+1,last_event=? WHERE group_id=? AND id=? AND version=?",
				)
				.bind(
					next.title,
					next.kind,
					next.interval ?? 1,
					next.day ?? null,
					next.month ?? null,
					next.anchor_at,
					next.next_at,
					next.status,
					event,
					group,
					previous.id,
					previous.version,
				)
				.run();
			return result.meta.changes === 1;
		},
		async due(group, now) {
			return (
				await db
					.prepare(
						"SELECT * FROM reminders WHERE group_id=? AND status='active' AND next_at<=? ORDER BY next_at LIMIT 50",
					)
					.bind(group, now)
					.all<Reminder>()
			).results;
		},
		async wasSent(key) {
			return !!(await db
				.prepare("SELECT delivery_key FROM line_reminder_deliveries WHERE delivery_key=?")
				.bind(key)
				.first());
		},
		async finish(reminder, key, now, next) {
			await db.batch([
				db.prepare("INSERT OR IGNORE INTO line_reminder_deliveries VALUES (?,?)").bind(key, now),
				db
					.prepare(
						"UPDATE reminders SET next_at=?,status=?,version=version+1 WHERE id=? AND group_id=? AND version=?",
					)
					.bind(
						next ?? reminder.next_at,
						next === null ? "done" : "active",
						reminder.id,
						reminder.group_id,
						reminder.version,
					),
				db
					.prepare("DELETE FROM line_reminder_deliveries WHERE sent_at<?")
					.bind(now - 30 * 86400000),
			]);
		},
	};
}
