import type { Bindings } from "./create-app";
export async function dispatchMemory(now: number, env: Bindings) {
	const group = env.LINE_ALLOWED_GROUP_ID?.trim();
	if (!group || !env.CONVERSATIONS || !env.JOBS_QUEUE || !env.DB) return;
	await env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(group)).scheduleMemory(now);
}
