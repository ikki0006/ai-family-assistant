import { nextOccurrence } from "../../domain/reminders/recurrence";
import type { PushSender } from "../ports/push-sender";
import type { ReminderJob, ReminderRepository } from "../ports/reminder-repository";
export async function deliverReminder(
	repo: ReminderRepository,
	sender: PushSender,
	job: ReminderJob,
	allowedGroup: string,
	now: number,
) {
	if (job.groupId !== allowedGroup) return;
	const r = await repo.get(allowedGroup, job.id);
	if (
		!r ||
		r.status !== "active" ||
		r.version !== job.version ||
		r.next_at !== job.at ||
		job.at > now
	)
		return;
	const key = `reminder:${allowedGroup}:${r.id}:${r.version}:${job.at}`;
	const next = nextOccurrence({ kind: r.kind, at: r.anchor_at }, now);
	// Bound retries below LINE's retry-key lifetime; skip stale occurrences after outages.
	if (now - job.at < 23 * 3600000 && !(await repo.wasSent(key)))
		await sender.push(allowedGroup, `🔔 リマインド\n${r.title}`, key);
	await repo.finish(r, key, now, next);
}
