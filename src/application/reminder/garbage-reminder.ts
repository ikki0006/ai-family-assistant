import type {
	GarbageSchedule,
	GarbageScheduleStore,
	ReminderLedger,
} from "../ports/garbage-schedule";
import type { PushSender } from "../ports/push-sender";

const DAY = 86_400_000;
export const REMINDER_HOURS_JST = { evening: 23, morning: 8 } as const;
const CALENDAR_URL = "https://www.city.nerima.tokyo.jp/kurashi/gomi/wakekata/ichiran/";

export function planGarbageReminder(schedule: GarbageSchedule, scheduledTime: number) {
	const local = new Date(scheduledTime + 9 * 60 * 60 * 1000);
	const hour = local.getUTCHours();
	if (
		local.getUTCMinutes() > 10 ||
		![REMINDER_HOURS_JST.evening, REMINDER_HOURS_JST.morning].some((value) => value === hour)
	)
		return null;
	const evening = hour === REMINDER_HOURS_JST.evening;
	const target = new Date(local.getTime() + (evening ? DAY : 0));
	const date = target.toISOString().slice(0, 10);
	if (date < schedule.validFrom || date > schedule.validThrough) return null;
	const title = `${evening ? "明日" : "今日"}（${target.getUTCMonth() + 1}/${target.getUTCDate()}）のごみ・資源`;
	const key = `garbage:${date}:${evening ? "evening" : "morning"}`;
	const override = schedule.overrides[date];
	const specialPeriod =
		date.slice(5) === "12-31" || (target.getUTCMonth() === 0 && target.getUTCDate() <= 3);
	if (specialPeriod && override === undefined) {
		return {
			key,
			text: `${title}\n年末年始の特別日程が未確認です。通常の収集曜日では判断せず、区のお知らせを確認してください。\n${CALENDAR_URL}`,
		};
	}
	const labels =
		override ??
		schedule.rules
			.filter(
				(rule) =>
					rule.weekday === target.getUTCDay() &&
					(!rule.weeks || rule.weeks.includes(Math.ceil(target.getUTCDate() / 7))),
			)
			.map((rule) => rule.label);
	if (labels.length === 0) return null;
	return {
		key,
		text: `${title}\n${[...new Set(labels)].map((label) => `・${label}`).join("\n")}\n${evening ? "今夜は準備の確認を。出すのは収集日の朝です。" : "出し忘れがないか確認してください。"}`,
	};
}

export async function sendGarbageReminder(
	dependencies: {
		store: GarbageScheduleStore;
		ledger: ReminderLedger;
		sender: PushSender;
		groupId: string;
	},
	scheduledTime: number,
	now: number,
) {
	if (now < scheduledTime || now - scheduledTime > 15 * 60_000) return;
	const schedule = await dependencies.store.load();
	if (!schedule) throw new Error("Garbage schedule missing");
	const reminder = planGarbageReminder(schedule, scheduledTime);
	if (!reminder) return;
	const key = `${dependencies.groupId}:${reminder.key}`;
	if (await dependencies.ledger.wasSent(key)) return;
	// LINE deduplicates concurrent/retried sends via the same retry key.
	await dependencies.sender.push(dependencies.groupId, reminder.text, key);
	await dependencies.ledger.markSent(key, now);
}
