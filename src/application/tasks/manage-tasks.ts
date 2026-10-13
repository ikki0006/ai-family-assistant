import {
	type Schedule,
	formatJst,
	nextOccurrence,
	parseJst,
	validateSchedule,
} from "../../domain/reminders/recurrence";
import {
	type FamilyTask,
	type TaskState,
	addOccurrence,
	advanceTask,
} from "../../domain/tasks/task";
import type { FamilyProfile } from "../ports/family-profiles";
import type { FamilyTasks } from "../ports/family-tasks";
export type TaskAction = {
	op: "create" | "list" | "complete" | "pause" | "resume" | "delete";
	id?: string;
	occurrenceId?: string;
	title?: string;
	assignees?: string[];
	at?: string;
	kind?: Schedule["kind"];
	interval?: number;
	day?: number;
	month?: number;
};
export function parseTaskAction(value: unknown): TaskAction {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid task action");
	const v = value as Record<string, unknown>;
	if (!["create", "list", "complete", "pause", "resume", "delete"].includes(String(v.op)))
		throw new Error("Invalid task operation");
	for (const key of ["id", "occurrenceId", "title", "at"])
		if (v[key] !== undefined && (typeof v[key] !== "string" || (v[key] as string).length > 300))
			throw new Error("Invalid task field");
	if (
		v.assignees !== undefined &&
		(!Array.isArray(v.assignees) ||
			v.assignees.length < 1 ||
			v.assignees.length > 6 ||
			!v.assignees.every((s) => typeof s === "string" && /^U[0-9a-f]{32}$/.test(s)))
	)
		throw new Error("Invalid task assignees");
	if (
		v.kind !== undefined &&
		!["once", "daily", "weekly", "monthly", "yearly"].includes(String(v.kind))
	)
		throw new Error("Invalid task recurrence");
	for (const key of ["interval", "day", "month"])
		if (
			v[key] !== undefined &&
			(!Number.isInteger(v[key]) || Number(v[key]) < 1 || Number(v[key]) > 100)
		)
			throw new Error("Invalid task recurrence field");
	return v as TaskAction;
}
export function taskInventory(state: TaskState, now: number): string {
	if (!state.tasks.length) return "登録されたタスクはありません。";
	return state.tasks
		.map((t) => {
			const open = t.occurrences.filter((o) => o.doneAt === null);
			const lines = open
				.slice(0, 8)
				.map(
					(o) =>
						`${t.members.find((m) => m.speaker === o.speaker)?.name ?? "担当者"}: ${formatJst(o.dueAt)}${o.dueAt <= now ? "・未完了" : "・予定"}`,
				);
			return `${t.title}［${t.status === "paused" ? "停止中" : "有効"}］\n${lines.join("\n") || "現在の未完了分はありません。"}${open.length > 8 ? `\nほか${open.length - 8}件` : ""}${t.nextAt !== null ? `\n次の周期: ${formatJst(t.nextAt)}` : ""}`;
		})
		.join("\n\n");
}
export async function manageTasks(
	repo: FamilyTasks,
	group: string,
	event: string,
	action: TaskAction,
	actor: string,
	profiles: FamilyProfile[],
	now: number,
	expectedVersion?: number,
): Promise<string> {
	const state = await repo.load(group);
	if (action.op === "list") return taskInventory(state, now);
	if (await repo.applied(group, event)) return "このタスク操作は反映済みです。";
	if (expectedVersion !== undefined && state.version !== expectedVersion)
		return "タスクが更新されました。もう一度内容を確認してお願いします。";
	const tasks = state.tasks.map((t) => ({
		...t,
		members: [...t.members],
		occurrences: t.occurrences.map((o) => ({ ...o })),
	}));
	const save = async (text: string) =>
		(await repo.save(group, event, state, tasks))
			? text
			: "タスクが更新されました。もう一度お願いします。";
	if (action.op === "create") {
		if (!action.title?.trim() || !action.at || !action.kind || !action.assignees?.length)
			return "タスクの内容・担当者・初回の日時と通知時刻を教えてください。";
		if (tasks.length >= 20) return "タスクは20件までです。不要なものを削除してください。";
		const members = [...new Set(action.assignees)].map((speaker) => ({
			speaker,
			name:
				profiles.find((p) => p.speaker === speaker)?.names[0] ??
				(speaker === actor ? "依頼した本人" : ""),
		}));
		if (members.some((m) => !m.name))
			return "担当者の名前とLINEの発言者をまだ対応づけられません。本人のプロフィールを確認してから登録してください。";
		let schedule: Schedule;
		try {
			schedule = {
				kind: action.kind,
				at: parseJst(action.at),
				interval: action.interval ?? 1,
				day: action.day ?? null,
				month: action.month ?? null,
			};
			validateSchedule(schedule);
			if (schedule.at <= now || !Number.isFinite(schedule.at)) throw new Error();
		} catch {
			return "未来の初回日時と、対応する周期・通知時刻を教えてください。";
		}
		const task: FamilyTask = {
			id: `task:${event}`,
			title: action.title.trim(),
			schedule,
			members,
			status: "active",
			nextAt: nextOccurrence(schedule, schedule.at),
			occurrences: [],
			notifiedDay: null,
		};
		addOccurrence(task, schedule.at);
		tasks.push(task);
		return save(
			`「${task.title}」を登録しました。\n担当: ${members.map((m) => m.name).join("・")}\n初回: ${formatJst(schedule.at)}\n各自が完了するまで、未完了の人の分を毎日同じ時刻に家族グループへ通知します。`,
		);
	}
	const task = tasks.find((t) => t.id === action.id);
	if (!task)
		return "どのタスクか教えてください。対象が複数ある場合は名前と期限を指定してください。";
	if (action.op === "complete") {
		const candidates = task.occurrences.filter(
			(o) =>
				o.doneAt === null &&
				o.speaker === actor &&
				(!action.occurrenceId || o.id === action.occurrenceId),
		);
		if (candidates.length !== 1)
			return "あなたの未完了分を一つに特定できませんでした。どの期限のタスクを終えたか教えてください。";
		const occurrence = candidates[0];
		if (!occurrence) return "この分は完了済みか、あなたの担当ではありません。";
		occurrence.doneAt = now;
		const others = task.occurrences.filter(
			(o) => o.dueAt === occurrence.dueAt && o.doneAt === null,
		);
		return save(
			`「${task.title}」の${formatJst(occurrence.dueAt)}分、あなたの完了を記録しました。${others.length ? `\n残り: ${others.map((o) => task.members.find((m) => m.speaker === o.speaker)?.name ?? "担当者").join("・")}` : "\nこの回は全員完了です。"}`,
		);
	}
	if (action.op === "delete") {
		tasks.splice(tasks.indexOf(task), 1);
		return save(`「${task.title}」を削除しました。今後の通知も止めました。`);
	}
	task.status = action.op === "pause" ? "paused" : "active";
	if (action.op === "resume") advanceTask(task, now);
	return save(
		`「${task.title}」の通知を${action.op === "pause" ? "停止" : "再開"}しました。未完了分は保持しています。`,
	);
}
