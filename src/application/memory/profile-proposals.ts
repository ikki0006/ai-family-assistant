import type { ConversationMessage } from "../conversation/conversation";
import type { ProfileProposal } from "../ports/family-profiles";
export function parseProfileProposals(
	value: unknown,
	messages: ConversationMessage[],
): ProfileProposal[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 4) throw new Error("Invalid profiles");
	const proposals = value.map((v: unknown) => {
		if (!v || typeof v !== "object") throw new Error("Invalid profile");
		const p = v as Record<string, unknown>;
		if (
			typeof p.speaker !== "string" ||
			!/^U[0-9a-f]{32}$/.test(p.speaker) ||
			!Array.isArray(p.names) ||
			p.names.length < 1 ||
			p.names.length > 3 ||
			!p.names.every(
				(n) => typeof n === "string" && n.trim() === n && n.length > 0 && n.length <= 20,
			) ||
			!Array.isArray(p.sourceIds) ||
			p.sourceIds.length < 1 ||
			p.sourceIds.length > 10
		)
			throw new Error("Invalid profile fields");
		const sources = messages.filter(
			(m) =>
				m.role === "user" && m.speaker === p.speaker && (p.sourceIds as unknown[]).includes(m.id),
		);
		if (
			!p.sourceIds.every((id) => typeof id === "string" && sources.some((m) => m.id === id)) ||
			!p.names.every((n) => sources.some((m) => m.text.includes(String(n))))
		)
			throw new Error("Invalid profile provenance");
		return {
			occurredAt: Math.max(...sources.map((m) => m.occurredAt)),
			speaker: p.speaker,
			names: [...new Set(p.names as string[])],
			sourceIds: [...new Set(p.sourceIds as string[])],
		};
	});
	if (new Set(proposals.map((p) => p.speaker)).size !== proposals.length)
		throw new Error("Duplicate profiles");
	return proposals;
}
