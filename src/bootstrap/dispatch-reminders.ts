import type { ReminderJob } from "../application/ports/reminder-repository";
import { createReminderRepository } from "../infrastructure/persistence/d1/reminders";
import type { Bindings } from "./create-app";
export async function dispatchReminders(now: number, env: Bindings) {
	const group = env.LINE_ALLOWED_GROUP_ID?.trim();
	if (!group || !env.DB || !env.JOBS_QUEUE) throw new Error("Missing reminder configuration");
	const rows = await createReminderRepository(env.DB).due(group, now);
	if (rows.length)
		await env.JOBS_QUEUE.sendBatch(
			rows.map((r) => ({
				body: {
					type: "reminder",
					groupId: group,
					id: r.id,
					version: r.version,
					at: r.next_at,
				} satisfies ReminderJob,
			})),
		);
}
