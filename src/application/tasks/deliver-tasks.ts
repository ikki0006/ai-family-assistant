import { formatJst } from "../../domain/reminders/recurrence";
import {
	type FamilyTask,
	advanceTask,
	notificationSlot,
	pendingTasks,
} from "../../domain/tasks/task";
import type { FamilyTasks } from "../ports/family-tasks";
import type { PushSender } from "../ports/push-sender";
import type { QuickReply } from "../ports/quick-reply";
export async function deliverTasks(
	repo: FamilyTasks,
	sender: PushSender,
	group: string,
	now: number,
	buttons: (task: FamilyTask) => QuickReply[],
) {
	let state = await repo.load(group);
	const tasks = state.tasks.map((t) => ({
		...t,
		occurrences: t.occurrences.map((o) => ({ ...o })),
	}));
	for (const task of tasks) advanceTask(task, now);
	if (JSON.stringify(tasks) !== JSON.stringify(state.tasks)) {
		if (!(await repo.save(group, `advance:${state.version}:${now}`, state, tasks))) return;
		state = await repo.load(group);
	}
	for (const taskId of state.tasks.map((t) => t.id)) {
		const task = state.tasks.find((t) => t.id === taskId);
		if (!task) continue;
		const pending = pendingTasks(task, now);
		const slot = notificationSlot(task, now);
		if (
			task.status !== "active" ||
			!pending.length ||
			(task.notifiedDay !== null && task.notifiedDay >= slot)
		)
			continue;
		const key = `task:${group}:${task.id}:${slot}`;
		const lines = pending
			.slice(0, 12)
			.map(
				(o) =>
					`${task.members.find((m) => m.speaker === o.speaker)?.name ?? "担当者"}さん — ${formatJst(o.dueAt)}分`,
			);
		const text = `🔔 ${task.title}をお願いします。\n未完了: \n${lines.join("\n")}${pending.length > 12 ? `\nほか${pending.length - 12}件（タスク一覧で確認）` : ""}\n終わったら自分の完了ボタンか、私への返信で教えてください。完了まで毎日お知らせします。`;
		await sender.push(group, text, key, buttons(task));
		task.notifiedDay = slot;
		if (!(await repo.save(group, key, state, state.tasks)))
			throw new Error("Task delivery state conflict");
		state = await repo.load(group);
	}
}
