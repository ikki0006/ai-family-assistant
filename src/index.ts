export { FamilyConversationAgent } from "./bootstrap/family-conversation-agent";
import { createApp } from "./bootstrap/create-app";
import type { Bindings } from "./bootstrap/create-app";
import { dispatchMemory } from "./bootstrap/dispatch-memory";
import { dispatchReminders } from "./bootstrap/dispatch-reminders";
import { processGenerationBatch } from "./bootstrap/process-generation-batch";
import { runGarbageReminder } from "./bootstrap/run-garbage-reminder";

export default {
	async scheduled(controller, env) {
		const results = await Promise.allSettled([
			runGarbageReminder(controller.scheduledTime, env),
			dispatchReminders(controller.scheduledTime, env),
			dispatchMemory(controller.scheduledTime, env),
		]);
		if (results.some((r) => r.status === "rejected")) throw new Error("Scheduled dispatch failed");
	},
	queue(batch, env) {
		return processGenerationBatch(batch, env);
	},
	fetch(request, env, context) {
		return createApp(env).fetch(request, env, context);
	},
} satisfies ExportedHandler<Bindings>;
