import { createApp } from "./bootstrap/create-app";
import type { Bindings } from "./bootstrap/create-app";

export default {
	fetch(request, env, context) {
		return createApp(env).fetch(request, env, context);
	},
} satisfies ExportedHandler<Bindings>;
