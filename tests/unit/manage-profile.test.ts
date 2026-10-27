import { expect, it, vi } from "vitest";
import type { FamilyProfiles } from "../../src/application/ports/family-profiles";
import { manageProfile, parseProfileCommand } from "../../src/application/profiles/manage-profile";
const speaker = `U${"1".repeat(32)}`;
const input = { group: "family", speaker, messageId: "message", occurredAt: 100 };
function repository() {
	return {
		list: vi.fn<FamilyProfiles["list"]>().mockResolvedValue([]),
		propose: vi.fn<FamilyProfiles["propose"]>().mockResolvedValue(undefined),
		confirm: vi.fn<FamilyProfiles["confirm"]>().mockResolvedValue(true),
		removeSources: vi.fn<FamilyProfiles["removeSources"]>().mockResolvedValue(undefined),
		remove: vi.fn<FamilyProfiles["remove"]>().mockResolvedValue(undefined),
		clear: vi.fn<FamilyProfiles["clear"]>().mockResolvedValue(undefined),
	};
}
const memory = () => ({
	clear: vi.fn(async () => {}),
	forget: vi.fn(async (_ids: string[]) => {}),
});

it("parses existing commands without treating ordinary conversation as a command", () => {
	expect(parseProfileCommand("プロフィール登録: 花子、はな")).toEqual({
		type: "register",
		names: ["花子", "はな"],
	});
	expect(parseProfileCommand("プロフィール承認 2")).toEqual({ type: "confirm", version: 2 });
	expect(parseProfileCommand("プロフィールを知りたい")).toBeNull();
});
it("confirms only the sender and refuses an invalid identity", async () => {
	const repo = repository();
	await manageProfile({ type: "confirm", version: 2 }, input, repo, memory());
	expect(repo.confirm).toHaveBeenCalledWith("family", speaker, 2);
	repo.confirm.mockClear();
	await manageProfile(
		{ type: "confirm", version: 2 },
		{ ...input, speaker: undefined },
		repo,
		memory(),
	);
	expect(repo.confirm).not.toHaveBeenCalled();
});
it("preserves provenance and confirms only the exact pending names", async () => {
	const repo = repository();
	const row = { speaker, names: [], pending: ["花子"], sourceIds: ["message"], version: 2 };
	repo.list
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([row])
		.mockResolvedValueOnce([{ ...row, names: ["花子"], pending: [] }]);
	expect(
		await manageProfile({ type: "register", names: ["花子"] }, input, repo, memory()),
	).toContain("登録しました");
	expect(repo.propose).toHaveBeenCalledWith("family", {
		speaker,
		occurredAt: 100,
		names: ["花子"],
		sourceIds: ["message"],
	});
	expect(repo.confirm).toHaveBeenCalledWith("family", speaker, 2);
	repo.confirm.mockClear();
	repo.list.mockResolvedValue([row]);
	await manageProfile({ type: "register", names: ["別の名前"] }, input, repo, memory());
	expect(repo.confirm).not.toHaveBeenCalled();
});
it("does not delete profiles when clearing source memories fails", async () => {
	const repo = repository();
	const effects = memory();
	effects.clear.mockRejectedValue(new Error("storage unavailable"));
	await expect(manageProfile({ type: "clear" }, input, repo, effects)).rejects.toThrow();
	expect(repo.clear).not.toHaveBeenCalled();
	repo.list.mockResolvedValue([
		{ speaker, names: [], pending: [], sourceIds: ["original"], version: 1 },
	]);
	effects.forget.mockRejectedValue(new Error("storage unavailable"));
	await expect(manageProfile({ type: "remove" }, input, repo, effects)).rejects.toThrow();
	expect(effects.forget).toHaveBeenCalledWith(["original"]);
	expect(repo.remove).not.toHaveBeenCalled();
});
