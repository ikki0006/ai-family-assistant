import { sendGarbageReminder } from "../application/reminder/garbage-reminder";
import { createLinePushSender } from "../infrastructure/line/push-sender";
import { diagnostics } from "../infrastructure/observability/diagnostics";
import {
	createGarbageScheduleStore,
	createReminderLedger,
} from "../infrastructure/persistence/d1/garbage-schedule";
import type { Bindings } from "./create-app";

export async function runGarbageReminder(
	scheduledTime: number,
	env: Bindings,
	fetcher: typeof fetch = fetch,
	now = Date.now(),
) {
	try {
		const groupId = env.LINE_ALLOWED_GROUP_ID?.trim();
		const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
		if (!groupId || !/^C[0-9a-f]{32}$/.test(groupId) || !token || !env.DB)
			throw new Error("Reminder configuration missing");
		await sendGarbageReminder(
			{
				store: createGarbageScheduleStore(env.DB),
				ledger: createReminderLedger(env.DB),
				sender: createLinePushSender(token, fetcher, diagnostics, async (id, text) => {
					if (env.CONVERSATIONS)
						await env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(groupId)).recordSent(id, text);
				}),
				groupId,
			},
			scheduledTime,
			now,
		);
	} catch {
		diagnostics.failure("garbage_reminder_failed");
		throw new Error("Garbage reminder failed");
	}
}
