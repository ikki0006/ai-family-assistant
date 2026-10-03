import { describe, expect, it } from "vitest";
import { createRouter } from "../../src/presentation/router/create-router";

describe("router boundary", () => {
	it("does not expose exception contents to the caller", async () => {
		const router = createRouter({
			getHealth() {
				throw new Error("private conversation and API credential");
			},
		});
		const response = await router.request("/health");
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "internal_error" });
	});
});
