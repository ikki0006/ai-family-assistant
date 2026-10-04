export { FamilyConversationAgent } from "./bootstrap/family-conversation-agent";
import { createApp } from "./bootstrap/create-app";
import type { Bindings } from "./bootstrap/create-app";
import { processGenerationBatch } from "./bootstrap/process-generation-batch";
import { runGarbageReminder } from "./bootstrap/run-garbage-reminder";

export default {
	async scheduled(controller, env) {
		await runGarbageReminder(controller.scheduledTime, env);
	},
	queue(batch, env) {
		return processGenerationBatch(batch, env);
	},
	fetch(request, env, context) {
		return createApp(env).fetch(request, env, context);
	},
} satisfies ExportedHandler<Bindings>;
