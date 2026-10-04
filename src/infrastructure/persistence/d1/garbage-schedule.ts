import { z } from "zod";
import type {
	GarbageScheduleStore,
	ReminderLedger,
} from "../../../application/ports/garbage-schedule";

const date = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine((value) => {
		const timestamp = Date.parse(`${value}T00:00:00Z`);
		return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
	});
export const garbageScheduleSchema = z
	.object({
		validFrom: date,
		validThrough: date,
		rules: z
			.array(
				z.object({
					label: z.string().min(1).max(100),
					weekday: z.number().int().min(0).max(6),
					weeks: z.array(z.number().int().min(1).max(5)).min(1).max(5).optional(),
				}),
			)
			.max(30),
		overrides: z.record(date, z.array(z.string().min(1).max(100)).max(20)),
	})
	.refine((value) => value.validFrom <= value.validThrough);

export function createGarbageScheduleStore(db: D1Database): GarbageScheduleStore {
	return {
		async load() {
			const row = await db
				.prepare("SELECT config_json FROM garbage_schedule WHERE id = 1")
				.first<{ config_json: string }>();
			if (!row) return null;
			const schedule = garbageScheduleSchema.parse(JSON.parse(row.config_json));
			return {
				...schedule,
				rules: schedule.rules.map(({ weeks, ...rule }) =>
					weeks === undefined ? rule : { ...rule, weeks },
				),
			};
		},
	};
}

async function digest(key: string): Promise<string> {
	const bytes = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
	);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function createReminderLedger(db: D1Database): ReminderLedger {
	return {
		async wasSent(key) {
			return (
				(await db
					.prepare("SELECT 1 FROM reminder_deliveries WHERE id = ?")
					.bind(await digest(key))
					.first()) !== null
			);
		},
		async markSent(key, sentAt) {
			await db
				.prepare(
					"INSERT INTO reminder_deliveries (id, sent_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING",
				)
				.bind(await digest(key), sentAt)
				.run();
			await db
				.prepare("DELETE FROM reminder_deliveries WHERE sent_at < ?")
				.bind(sentAt - 90 * 86_400_000)
				.run();
		},
	};
}
