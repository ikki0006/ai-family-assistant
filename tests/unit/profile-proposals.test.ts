import { expect, it } from "vitest";
import { parseProfileProposals } from "../../src/application/memory/profile-proposals";
const speaker = `U${"1".repeat(32)}`;
const messages = [
	{
		id: "m",
		speaker,
		text: "私はテスト太郎。たろうと呼んで",
		role: "user" as const,
		occurredAt: 1,
		day: "2026-10-04",
	},
];
it("keeps self-sourced names as proposals", () => {
	expect(
		parseProfileProposals(
			[{ speaker, names: ["テスト太郎", "たろう"], sourceIds: ["m"] }],
			messages,
		),
	).toHaveLength(1);
});
it("rejects other speakers, assistant sources and invented names", () => {
	for (const value of [
		{ speaker: `U${"2".repeat(32)}`, names: ["テスト太郎"], sourceIds: ["m"] },
		{ speaker, names: ["別の名前"], sourceIds: ["m"] },
		{ speaker, names: ["テスト太郎"], sourceIds: ["missing"] },
		{ speaker: "unknown", names: ["テスト太郎"], sourceIds: ["m"] },
	])
		expect(() => parseProfileProposals([value], messages)).toThrow();
	expect(() =>
		parseProfileProposals(
			[{ speaker, names: ["テスト太郎"], sourceIds: ["m"] }],
			messages.map((m) => ({ ...m, role: "assistant" as const })),
		),
	).toThrow();
});
