import { contextSize } from "../conversation/build-context";
import type { MemoryBatch } from "../conversation/conversation";
import type { FamilyProfile } from "../ports/family-profiles";
import type { MemoryFact, MemoryUpdate } from "../ports/long-term-memory";
import type { TextGenerator } from "../ports/text-generator";
import { ORGANIZE_MEMORY_PROMPT } from "../prompts/organize-memory";
import { parseProfileProposals } from "./profile-proposals";
export async function organizeMemory(
	batch: MemoryBatch,
	existing: MemoryFact[],
	generator: TextGenerator,
	now: number,
	profiles: FamilyProfile[] = [],
) {
	const raw = await generator.generate({
		system: ORGANIZE_MEMORY_PROMPT,
		messages: [
			{
				role: "user",
				content: JSON.stringify({
					now: new Date(now).toISOString(),
					previousSummary: batch.previousSummary,
					profiles: profiles.map(({ speaker, names, pending }) => ({ speaker, names, pending })),
					messages: batch.messages,
					existing: existing.map(({ id, subject, key, text }) => ({ id, subject, key, text })),
				}),
			},
		],
	});
	const value = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as {
		profiles?: unknown;
		summary?: unknown;
		updates?: unknown;
		retire?: unknown;
	};
	if (
		typeof value.summary !== "string" ||
		!value.summary.trim() ||
		contextSize(value.summary) > 3200 ||
		!Array.isArray(value.updates) ||
		value.updates.length > 8 ||
		!Array.isArray(value.retire) ||
		value.retire.length > 8
	)
		throw new Error("Invalid memory proposal");
	const users = batch.messages.filter((m) => m.role === "user");
	const sources = (input: unknown): string[] => {
		if (
			!Array.isArray(input) ||
			!input.length ||
			input.length > 30 ||
			!input.every((id) => typeof id === "string" && users.some((m) => m.id === id))
		)
			throw new Error("Invalid memory provenance");
		return [...new Set(input)] as string[];
	};
	const updates: MemoryUpdate[] = value.updates.map((input: unknown) => {
		if (!input || typeof input !== "object") throw new Error("Invalid memory update");
		const v = input as Record<string, unknown>;
		const sourceIds = sources(v.sourceIds);
		if (
			typeof v.subject !== "string" ||
			(v.subject !== "family" &&
				!users.some((m) => m.speaker === v.subject && sourceIds.includes(m.id))) ||
			typeof v.key !== "string" ||
			!v.key.trim() ||
			v.key.length > 80 ||
			typeof v.text !== "string" ||
			!v.text.trim() ||
			v.text.length > 300 ||
			(v.expiresAt !== null &&
				(typeof v.expiresAt !== "number" ||
					!Number.isSafeInteger(v.expiresAt) ||
					v.expiresAt <= now ||
					v.expiresAt > now + 366 * 86400000))
		)
			throw new Error("Invalid memory update");
		return {
			subject: v.subject,
			key: v.key,
			text: v.text,
			sourceIds,
			expiresAt: v.expiresAt as number | null,
		};
	});
	if (new Set(updates.map((u) => JSON.stringify([u.subject, u.key]))).size !== updates.length)
		throw new Error("Duplicate memory keys");

	const retire: string[] = value.retire.map((input: unknown) => {
		if (!input || typeof input !== "object") throw new Error("Invalid retirement");
		const v = input as Record<string, unknown>;
		sources(v.sourceIds);
		if (typeof v.id !== "string" || !existing.some((f) => f.id === v.id))
			throw new Error("Unknown memory");
		return v.id;
	});
	return {
		summary: value.summary,
		updates,
		retire,
		profiles: parseProfileProposals(value.profiles, batch.messages),
	};
}
