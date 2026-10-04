import type { Reminder } from "../../domain/reminders/recurrence";
import { describeRecurrence, formatJst } from "../../domain/reminders/recurrence";
import type { GarbageSchedule } from "../ports/garbage-schedule";
import type { MemoryFact } from "../ports/long-term-memory";
export type MemoryCommand =
	| { type: "list"; page: number }
	| { type: "schedules"; page: number }
	| { type: "remember"; text: string }
	| { type: "forget"; id: string }
	| { type: "clear" };
export function memoryCommand(text: string): MemoryCommand | null {
	const t = text.trim().replace(/[？?。！!]+$/, "");
	const list =
		/^(?:記憶一覧|何を覚えて(?:る|いる)(?:の)?|今何を記憶して(?:る|いる))(?:\s+(\d+))?$/.exec(t);
	if (list) return { type: "list", page: Math.max(1, Number(list[1] ?? 1)) };
	const schedules =
		/^(?:予定一覧|スケジュール一覧|今の予定(?:は)?|何がスケジュールに(?:ある|入ってる))(?:\s+(\d+))?$/.exec(
			t,
		);
	if (schedules) return { type: "schedules", page: Math.max(1, Number(schedules[1] ?? 1)) };
	const remember = /^覚えて[:：]\s*([\s\S]+)$/.exec(t);
	if (remember?.[1]) return { type: "remember", text: remember[1] };
	const forget = /^記憶削除\s+([0-9a-f-]{36})$/.exec(t);
	if (forget?.[1]) return { type: "forget", id: forget[1] };
	if (t === "記憶全消去") return { type: "clear" };
	return null;
}
export function memoryInventory(facts: MemoryFact[], page: number): string {
	const pages = Math.max(1, Math.ceil(facts.length / 4));
	const selected = facts.slice((page - 1) * 4, page * 4);
	return `長期記憶：${facts.length}件（${page}/${pages}ページ）\n${selected.map((f) => `・${f.text}\nID: ${f.id}${f.expiresAt ? `\n期限: ${formatJst(f.expiresAt)}` : ""}`).join("\n\n") || "このページに記憶はありません。"}\n\n会話原文は別に7日間保持します。自動整理前の発言はこの一覧に含まれません。\n「記憶一覧 2」で次のページ、「記憶削除 ID」で削除できます。`;
}
export function scheduleInventory(
	reminders: Reminder[],
	garbage: GarbageSchedule | null,
	page: number,
	now: number,
): string {
	const status = { active: "有効", paused: "停止中", done: "完了", deleted: "削除済み" };
	const entries = reminders
		.filter((r) => r.status !== "deleted")
		.map(
			(r) =>
				`・${r.title}（${describeRecurrence(r)}・${status[r.status]}）\n${r.status === "done" ? "最終予定" : "次回予定"}: ${formatJst(r.next_at)}`,
		);
	if (garbage) {
		const today = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
		entries.push(
			`・ゴミ出し通知：前日23時／当日8時（日本時間）\n収集設定の期間: ${garbage.validFrom}〜${garbage.validThrough}${today > garbage.validThrough ? "（期限切れ）" : today < garbage.validFrom ? "（開始前）" : ""}`,
		);
		for (const rule of garbage.rules)
			entries.push(
				`・${rule.label}: ${rule.weeks?.length ? `第${rule.weeks.join("・")}` : "毎週"}${"日月火水木金土"[rule.weekday]}曜日`,
			);
		for (const [date, labels] of Object.entries(garbage.overrides).sort())
			if (date >= today) entries.push(`・${date}の収集例外: ${labels.join("、") || "収集なし"}`);
	}
	return `登録スケジュール（日本時間・${page}/${Math.max(1, Math.ceil(entries.length / 4))}ページ）\n\n${entries.slice((page - 1) * 4, page * 4).join("\n\n") || "このページに予定はありません。"}\n\n「予定一覧 2」で次のページを確認できます。停止中の通知は送信されません。`;
}
export function relevantMemories(facts: MemoryFact[], text: string): MemoryFact[] {
	const chars = Array.from(text);
	const terms = new Set(chars.slice(0, -1).map((c, i) => c + (chars[i + 1] ?? "")));
	return [...facts]
		.map((f) => ({ f, score: [...terms].filter((t) => f.text.includes(t)).length }))
		.sort((a, b) => b.score - a.score || b.f.updatedAt - a.f.updatedAt)
		.slice(0, 8)
		.map((v) => v.f);
}
