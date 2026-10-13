import { expect, it, vi } from "vitest";
import type { FamilyTasks } from "../../src/application/ports/family-tasks";
import { deliverTasks } from "../../src/application/tasks/deliver-tasks";
import { manageTasks, parseTaskAction } from "../../src/application/tasks/manage-tasks";
import { nextOccurrence } from "../../src/domain/reminders/recurrence";
import {
	type FamilyTask,
	type TaskState,
	addOccurrence,
	advanceTask,
} from "../../src/domain/tasks/task";
const A = `U${"1".repeat(32)}`;
const B = `U${"2".repeat(32)}`;
const at = Date.parse("2026-10-27T18:00:00+09:00");
const profiles = [A, B].map((speaker, i) => ({
	speaker,
	names: [i ? "架空B" : "架空A"],
	pending: [],
	sourceIds: [],
	version: 1,
}));
function repository() {
	let state: TaskState = { version: 0, tasks: [] };
	const events = new Set<string>();
	const repo: FamilyTasks = {
		load: async () => structuredClone(state),
		applied: async (_g, e) => events.has(e),
		save: async (_g, e, previous, tasks) => {
			if (events.has(e) || previous.version !== state.version) return false;
			state = { version: previous.version + 1, tasks: structuredClone(tasks) };
			events.add(e);
			return true;
		},
	};
	return repo;
}
async function create(repo: FamilyTasks, event = "create") {
	return manageTasks(
		repo,
		"group",
		event,
		{
			op: "create",
			title: "銀行振込",
			assignees: [A, B],
			kind: "monthly",
			day: 27,
			at: "2026-10-27T18:00:00+09:00",
		},
		A,
		profiles,
		at - 1000,
	);
}
it("creates per-person periods, requires time and confirmed identities, and deduplicates requests", async () => {
	const repo = repository();
	expect(
		await manageTasks(
			repo,
			"g",
			"missing",
			{ op: "create", title: "振込" },
			A,
			profiles,
			at - 1000,
		),
	).toContain("通知時刻");
	expect(
		await manageTasks(
			repo,
			"g",
			"unknown",
			{
				op: "create",
				title: "振込",
				assignees: [B],
				kind: "once",
				at: "2026-10-27T18:00:00+09:00",
			},
			A,
			[],
			at - 1000,
		),
	).toContain("対応づけられません");
	await create(repo);
	await create(repo);
	expect((await repo.load("group")).tasks).toHaveLength(1);
	expect((await repo.load("group")).tasks[0]?.occurrences).toHaveLength(2);
	expect(() => parseTaskAction({ op: "create", assignees: ["made-up"] })).toThrow();
});
it("notifies daily only while pending, separately completes owners and creates new monthly periods", async () => {
	const repo = repository();
	await create(repo);
	const push = vi.fn();
	await deliverTasks(repo, { push }, "group", at - 1, () => []);
	expect(push).not.toHaveBeenCalled();
	await deliverTasks(repo, { push }, "group", at, () => []);
	await deliverTasks(repo, { push }, "group", at + 300000, () => []);
	expect(push).toHaveBeenCalledTimes(1);
	let task = (await repo.load("group")).tasks[0];
	if (!task) throw new Error();
	const a = task.occurrences.find((o) => o.speaker === A);
	if (!a) throw new Error();
	expect(
		await manageTasks(
			repo,
			"group",
			"wrong",
			{ op: "complete", id: task.id, occurrenceId: a.id },
			B,
			profiles,
			at + 1,
		),
	).toContain("特定できません");
	await manageTasks(
		repo,
		"group",
		"done-a",
		{ op: "complete", id: task.id, occurrenceId: a.id },
		A,
		profiles,
		at + 1,
	);
	await deliverTasks(repo, { push }, "group", at + 86400000, () => []);
	expect(push).toHaveBeenCalledTimes(2);
	expect(push.mock.calls[1]?.[1]).not.toContain("架空A");
	expect(push.mock.calls[1]?.[1]).toContain("架空B");
	await manageTasks(
		repo,
		"group",
		"done-b",
		{ op: "complete", id: task.id },
		B,
		profiles,
		at + 86400001,
	);
	await deliverTasks(repo, { push }, "group", at + 2 * 86400000, () => []);
	expect(push).toHaveBeenCalledTimes(2);
	const next = Date.parse("2026-11-27T18:00:00+09:00");
	await deliverTasks(repo, { push }, "group", next, () => []);
	expect(push).toHaveBeenCalledTimes(3);
	task = (await repo.load("group")).tasks[0];
	expect(task?.occurrences.filter((o) => o.doneAt === null)).toHaveLength(2);
	expect(push.mock.calls[2]?.[1]).toContain("架空A");
});
it("keeps overdue periods across months and requires disambiguation", async () => {
	const repo = repository();
	await create(repo);
	await deliverTasks(
		repo,
		{ push: vi.fn() },
		"group",
		Date.parse("2026-11-27T18:00:00+09:00"),
		() => [],
	);
	const t = (await repo.load("group")).tasks[0];
	if (!t) throw new Error();
	expect(t.occurrences.filter((o) => o.doneAt === null)).toHaveLength(4);
	expect(
		await manageTasks(
			repo,
			"group",
			"ambiguous",
			{ op: "complete", id: t.id },
			A,
			profiles,
			at + 1,
		),
	).toContain("どの期限");
});
it("persists delivery for multiple definitions and retries failed pushes with the same key", async () => {
	const repo = repository();
	await create(repo);
	await create(repo, "second");
	const push = vi.fn();
	await deliverTasks(repo, { push }, "group", at, () => []);
	await deliverTasks(repo, { push }, "group", at + 1, () => []);
	expect(push).toHaveBeenCalledTimes(2);
	const failing = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
	await expect(
		deliverTasks(repo, { push: failing }, "group", at + 86400000, () => []),
	).rejects.toThrow();
	await deliverTasks(repo, { push: failing }, "group", at + 86400001, () => []);
	expect(failing.mock.calls[0]?.[2]).toBe(failing.mock.calls[1]?.[2]);
});
it("pause retains pending items and delete stops notifications", async () => {
	const repo = repository();
	await create(repo);
	const t = (await repo.load("group")).tasks[0];
	if (!t) throw new Error();
	const push = vi.fn();
	await manageTasks(repo, "group", "pause", { op: "pause", id: t.id }, A, profiles, at);
	await deliverTasks(repo, { push }, "group", at, () => []);
	expect(push).not.toHaveBeenCalled();
	await manageTasks(repo, "group", "resume", { op: "resume", id: t.id }, A, profiles, at + 1);
	await deliverTasks(repo, { push }, "group", at + 1, () => []);
	expect(push).toHaveBeenCalledTimes(1);
	await manageTasks(repo, "group", "delete", { op: "delete", id: t.id }, A, profiles, at + 2);
	await deliverTasks(repo, { push }, "group", at + 86400000, () => []);
	expect(push).toHaveBeenCalledTimes(1);
});
it("reuses calendar rules including month ends and leap years", () => {
	const schedule = {
		kind: "yearly" as const,
		at: Date.parse("2024-02-29T09:00:00+09:00"),
		month: 2,
		day: 29,
	};
	const t: FamilyTask = {
		id: "t",
		title: "test",
		schedule,
		members: [{ speaker: A, name: "A" }],
		status: "active",
		nextAt: nextOccurrence(schedule, schedule.at),
		occurrences: [],
		notifiedDay: null,
	};
	addOccurrence(t, schedule.at);
	advanceTask(t, Date.parse("2025-02-28T09:00:00+09:00"));
	expect(t.occurrences).toHaveLength(2);
	expect(new Date(t.occurrences[1]?.dueAt ?? 0).toISOString()).toBe("2025-02-28T00:00:00.000Z");
});
