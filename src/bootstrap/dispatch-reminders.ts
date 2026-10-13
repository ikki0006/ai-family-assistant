import type { ReminderJob } from "../application/ports/reminder-repository";
import { notificationSlot, pendingTasks } from "../domain/tasks/task";
import { createFamilyTasks, familyTasksReady } from "../infrastructure/persistence/d1/family-tasks";
import { createReminderRepository } from "../infrastructure/persistence/d1/reminders";
import type { Bindings } from "./create-app";
export async function dispatchReminders(now: number, env: Bindings) {
	const group = env.LINE_ALLOWED_GROUP_ID?.trim();
	if (!group || !env.DB || !env.JOBS_QUEUE) throw new Error("Missing reminder configuration");
	if (await familyTasksReady(env.DB)) {
		const state = await createFamilyTasks(env.DB).load(group);
		if (
			state.tasks.some(
				(t) =>
					t.status === "active" &&
					((t.nextAt !== null && t.nextAt <= now) ||
						(pendingTasks(t, now).length > 0 &&
							(t.notifiedDay === null || t.notifiedDay < notificationSlot(t, now)))),
			)
		)
			await env.JOBS_QUEUE.send({ type: "tasks", groupId: group });
	}
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
