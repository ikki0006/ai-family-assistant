import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { IncomingText } from "../../application/conversation/respond-to-ping";
import type { getHealth } from "../../application/health/get-health";
import type { Diagnostics } from "../../application/ports/diagnostics";
import { parseWebhook } from "./line-webhook";

export interface RouterDependencies {
	getHealth: typeof getHealth;
	diagnostics?: Diagnostics;
	line?: {
		verifySignature(body: ArrayBuffer, signature: string): Promise<boolean>;
		respond(message: IncomingText): Promise<void>;
	};
}

export function createRouter(dependencies: RouterDependencies) {
	const router = new Hono();
	router.get("/health", (context) => context.json(dependencies.getHealth()));
	router.use("/webhooks/line", bodyLimit({ maxSize: 256 * 1024 }));
	router.post("/webhooks/line", async (context) => {
		const line = dependencies.line;
		if (!line) {
			dependencies.diagnostics?.failure("line_not_configured");
			return context.json({ error: "line_not_configured" }, 503);
		}
		const signature = context.req.header("x-line-signature");
		if (!signature) {
			dependencies.diagnostics?.failure("invalid_signature");
			return context.json({ error: "invalid_signature" }, 401);
		}
		const raw = await context.req.arrayBuffer();
		if (!(await line.verifySignature(raw, signature))) {
			dependencies.diagnostics?.failure("invalid_signature");
			return context.json({ error: "invalid_signature" }, 401);
		}
		const messages = parseWebhook(new TextDecoder().decode(raw));
		if (!messages) {
			dependencies.diagnostics?.failure("invalid_payload");
			return context.json({ error: "invalid_payload" }, 400);
		}
		// Await replies so transport failures become non-2xx webhook responses.
		const replies = await Promise.allSettled(messages.map((message) => line.respond(message)));
		if (replies.some((reply) => reply.status === "rejected")) {
			dependencies.diagnostics?.failure("reply_failed");
			return context.json({ error: "reply_failed" }, 502);
		}
		return context.json({ ok: true });
	});
	router.notFound((context) => context.json({ error: "not_found" }, 404));
	router.onError((_error, context) => {
		dependencies.diagnostics?.failure("internal_error");
		return context.json({ error: "internal_error" }, 500);
	});
	return router;
}
