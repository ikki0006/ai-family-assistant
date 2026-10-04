import { describe, expect, it, vi } from "vitest";
import { handleImprovement } from "../../src/application/improvements/handle-improvement";
import type {
	Improvement,
	ImprovementRepository,
} from "../../src/application/ports/improvement-repository";
import { createImprovementDispatcher } from "../../src/infrastructure/github/improvement-dispatcher";

const id = "11111111-1111-4111-a111-111111111111";
function setup() {
	const request: Improvement = {
		id,
		groupId: "group",
		specification: "回答を短くする",
		version: 1,
		status: "pending",
	};
	const repository: ImprovementRepository = {
		create: vi.fn(async () => request),
		get: vi.fn(async () => request),
		claim: vi.fn(async () => true),
		finish: vi.fn(async () => undefined),
	};
	const dispatcher = { dispatch: vi.fn(async () => undefined) };
	return { repository, dispatcher };
}
const input = { text: `改善承認 ${id} 1`, eventId: "event", groupId: "group" };
describe("improvement approval", () => {
	it("does not dispatch proposals", async () => {
		const deps = setup();
		expect(await handleImprovement({ ...input, text: "改善: 回答を短くする" }, deps)).toContain(
			`改善承認 ${id} 1`,
		);
		expect(deps.dispatcher.dispatch).not.toHaveBeenCalled();
	});
	it("allows approval from the authorized family group without a per-user restriction", async () => {
		const deps = setup();
		await handleImprovement(input, deps);
		expect(deps.dispatcher.dispatch).toHaveBeenCalledOnce();
	});
	it("rejects stale versions", async () => {
		const deps = setup();
		await handleImprovement({ ...input, text: `改善承認 ${id} 2` }, deps);
		expect(deps.dispatcher.dispatch).not.toHaveBeenCalled();
	});
	it("does not redispatch an already claimed request", async () => {
		const deps = setup();
		vi.mocked(deps.repository.claim).mockResolvedValue(false);
		await handleImprovement(input, deps);
		expect(deps.dispatcher.dispatch).not.toHaveBeenCalled();
	});
	it("marks uncertain network outcomes without retry", async () => {
		const deps = setup();
		deps.dispatcher.dispatch.mockRejectedValue(new Error("network"));
		await handleImprovement(input, deps);
		expect(deps.repository.finish).toHaveBeenCalledWith("group", id, "uncertain");
		expect(deps.dispatcher.dispatch).toHaveBeenCalledTimes(1);
	});
	it("dispatches only the fixed repository, workflow, ref", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
		await createImprovementDispatcher("test-token", fetcher).dispatch(
			(await setup().repository.get("group", id)) as Improvement,
		);
		expect(fetcher.mock.calls[0]?.[0]).toBe(
			"https://api.github.com/repos/ikki0006/ai-family-assistant/actions/workflows/improvement.yml/dispatches",
		);
		const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
		expect(body.ref).toBe("main");
		expect(body.inputs.request_id).toBe(id);
	});
});

it("accepts natural PR requests as proposals without dispatching", async () => {
	const deps = setup();
	const text = "ゴミの予定をDBから参照できるように改良してプルリク上げて";
	expect(await handleImprovement({ ...input, text }, deps)).toContain("改善承認");
	expect(deps.repository.create).toHaveBeenCalledWith("group", "event", text);
	expect(deps.dispatcher.dispatch).not.toHaveBeenCalled();
	expect(await handleImprovement({ ...input, text: "明日ごみを出して" }, deps)).toBeNull();
});
