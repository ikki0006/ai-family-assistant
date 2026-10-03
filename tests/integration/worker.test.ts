import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import worker from "../../src/index";

it("serves the composed router in the Workers runtime", async () => {
	const context = createExecutionContext();
	const response = await worker.fetch(new Request("https://example.test/health"), env, context);
	await waitOnExecutionContext(context);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ status: "ok", service: "ai-family-assistant" });
});
