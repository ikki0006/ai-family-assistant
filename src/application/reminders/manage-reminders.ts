import {
	describeRecurrence,
	formatJst,
	nextOccurrence,
	parseJst,
	validateSchedule,
} from "../../domain/reminders/recurrence";
import type { Recurrence, Reminder, Schedule } from "../../domain/reminders/recurrence";
import type { ReminderRepository } from "../ports/reminder-repository";
export type ReminderAction = Partial<Recurrence> & {
	action: "none" | "clarify" | "list" | "create" | "update" | "pause" | "resume" | "delete";
	question?: string;
	id?: string;
	version?: number;
	title?: string;
	at?: string;
};
export function parseReminderAction(raw: string): ReminderAction {
	const value: unknown = JSON.parse(
		raw
			.trim()
			.replace(/^```(?:json)?\s*/, "")
			.replace(/\s*```$/, ""),
	);
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid action");
	const o = value as Record<string, unknown>;
	if (
		!["none", "clarify", "list", "create", "update", "pause", "resume", "delete"].includes(
			String(o.action),
		)
	)
		throw new Error("Invalid action");
	for (const key of ["question", "id", "title", "at"])
		if (o[key] !== undefined && (typeof o[key] !== "string" || (o[key] as string).length > 500))
			throw new Error("Invalid action field");
	if (o.version !== undefined && (!Number.isSafeInteger(o.version) || Number(o.version) < 1))
		throw new Error("Invalid version");
	if (
		o.kind !== undefined &&
		!["once", "daily", "weekly", "monthly", "yearly"].includes(String(o.kind))
	)
		throw new Error("Invalid recurrence");
	for (const [field, max] of [
		["interval", 100],
		["day", 31],
		["month", 12],
	] as const)
		if (
			o[field] !== undefined &&
			(!Number.isInteger(o[field]) || Number(o[field]) < 1 || Number(o[field]) > max)
		)
			throw new Error("Invalid recurrence field");
	return o as ReminderAction;
}
export function describeReminder(r: Reminder) {
	return `${r.title}［${describeRecurrence(r)}・${r.status === "active" ? "有効" : r.status === "paused" ? "停止中" : "終了"}］\n次回: ${formatJst(r.next_at)}（日本時間）`;
}
export async function manageReminders(
	repo: ReminderRepository,
	group: string,
	event: string,
	action: ReminderAction,
	now: number,
): Promise<string | null> {
	if (action.action === "none") return null;
	if (action.action === "clarify") return action.question || "通知の内容と日時を教えてください。";
	if (action.action === "list") {
		const rows = await repo.list(group);
		return rows.length
			? rows.map((r, i) => `${i + 1}. ${describeReminder(r)}`).join("\n\n")
			: "登録されたリマインドはありません。";
	}
	let previous: Reminder | null = null;
	if (action.action !== "create") {
		previous = action.id ? await repo.get(group, action.id) : null;
		if (!previous || previous.status === "deleted")
			return "対象の通知が見つかりません。リマインド一覧で確認してください。";
		if (previous.last_event === event) return `操作は反映済みです。\n${describeReminder(previous)}`;
		if (previous.version !== action.version)
			return "通知の状態が変わりました。一覧を確認してもう一度依頼してください。";
	}
	if (action.action === "create" || action.action === "update") {
		if (!action.title?.trim() || action.title.length > 200 || !action.kind || !action.at)
			return "通知の内容と日時を確認させてください。";
		let at: number;
		let schedule: Schedule;
		try {
			at = parseJst(action.at);
			schedule = {
				kind: action.kind,
				at,
				interval: action.interval ?? (previous?.kind === action.kind ? previous.interval : 1) ?? 1,
				day: action.day ?? (previous?.kind === action.kind ? previous.day : null) ?? null,
				month: action.month ?? (previous?.kind === action.kind ? previous.month : null) ?? null,
			};
			validateSchedule(schedule);
		} catch {
			return "通知日時・繰り返し条件を確認させてください。周期、日付と時刻を指定してください。";
		}
		if (at <= now || at > now + 366 * 86400000 * (schedule.interval ?? 1))
			return "通知日時は未来を指定してください（初回は周期の間隔×1年以内）。";
		if (action.action === "create") {
			if ((await repo.list(group)).length >= 100)
				return "通知は100件までです。不要な通知を削除してください。";
			const r = await repo.create(group, event, action.title.trim(), schedule);
			return `登録しました。\n${describeReminder(r)}\n通知は5分間隔で確認するため、通常0〜5分ほど遅れます。`;
		}
		if (previous) {
			const next = {
				...previous,
				title: action.title.trim(),
				kind: schedule.kind,
				interval: schedule.interval ?? 1,
				day: schedule.day ?? null,
				month: schedule.month ?? null,
				anchor_at: at,
				next_at: at,
			};
			return (await repo.change(group, event, previous, next))
				? `変更しました。\n${describeReminder(next)}`
				: "状態が変わりました。もう一度依頼してください。";
		}
	}
	if (!previous) return "対象の通知を指定してください。";
	const next = { ...previous };
	if (action.action === "pause") next.status = "paused";
	if (action.action === "delete") {
		next.status = "deleted";
		next.title = "";
	}
	if (action.action === "resume") {
		const at = nextOccurrence({ ...previous, at: previous.anchor_at }, now);
		if (at === null)
			return "単発の通知日時を過ぎています。新しい日時へ変更してから再開してください。";
		next.next_at = at;
		next.status = "active";
	}
	if (!(await repo.change(group, event, previous, next)))
		return "状態が変わりました。もう一度依頼してください。";
	return action.action === "delete"
		? "通知を削除しました。"
		: `${action.action === "pause" ? "停止" : "再開"}しました。\n${describeReminder(next)}`;
}
