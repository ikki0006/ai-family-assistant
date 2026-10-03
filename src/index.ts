import { createApp } from "./bootstrap/create-app";
import type { Bindings } from "./bootstrap/create-app";
import { processGenerationBatch } from "./bootstrap/process-generation-batch";

export default {
	queue(batch, env) {
		return processGenerationBatch(batch, env);
	},
	fetch(request, env, context) {
		return createApp(env).fetch(request, env, context);
	},
} satisfies ExportedHandler<Bindings>;
