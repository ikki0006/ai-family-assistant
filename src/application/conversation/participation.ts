// Cheap prefilter: ordinary chat and stickers must not trigger an inference for every event.
export function reminderCandidate(text: string): boolean {
	return /リマインド|通知|締[め切]*切|〆切|期限|提出|忘れ|申[し込]*込|予約|明日|明後日|来週|毎[日週月]|[0-9０-９]+[時日]|[月火水木金土日]曜/.test(
		text,
	);
}

export function explicitReminderRequest(text: string): boolean {
	return /(?:リマインド|通知|知らせ|教え).*(?:して|てね|お願い|頼む|て$)|(?:通知|リマインド).*(?:停止|削除|再開|変更|一覧)|(?:停止|削除|再開|変更).*(?:通知|リマインド)/.test(
		text,
	);
}
