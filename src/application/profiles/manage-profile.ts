import type { FamilyProfile, FamilyProfiles } from "../ports/family-profiles";

export type ProfileCommand =
	| { type: "list" | "remove" | "clear" }
	| { type: "confirm"; version: number }
	| { type: "register"; names: string[] };

export function parseProfileCommand(text: string): ProfileCommand | null {
	const value = text.trim();
	if (value === "プロフィール一覧") return { type: "list" };
	if (value === "プロフィール削除") return { type: "remove" };
	if (value === "記憶・プロフィール全消去") return { type: "clear" };
	const approve = /^プロフィール承認\s+(\d+)$/.exec(value);
	if (approve) return { type: "confirm", version: Number(approve[1]) };
	const register = /^プロフィール登録[:：]\s*(.+)$/.exec(value);
	return register
		? { type: "register", names: register[1]?.split(/[、,]/).map((n) => n.trim()) ?? [] }
		: null;
}

function describeProfile(profile: FamilyProfile, speaker: string | undefined): string {
	const own = profile.speaker === speaker;
	const name = own ? "あなた" : (profile.names[0] ?? "未確認のメンバー");
	const heading = `${name}: ${profile.names.join("・") || "未登録"}`;
	if (!profile.pending.length) return heading;
	const confirmation = own
		? `\n本人が「プロフィール承認 ${profile.version}」で確定できます。`
		: "（本人の確認待ち）";
	return `${heading}\n確認待ち: ${profile.pending.join("・")}${confirmation}`;
}

async function registerProfile(
	profiles: FamilyProfiles,
	group: string,
	speaker: string,
	names: string[],
	messageId: string,
	occurredAt: number,
): Promise<string> {
	if (!names.length || names.length > 3 || names.some((n) => !n || n.length > 20))
		return "名前・呼び名を各20文字以内、最大3個まで読点で区切って指定してください。";
	await profiles.propose(group, { speaker, occurredAt, names, sourceIds: [messageId] });
	const updated = (await profiles.list(group)).find((p) => p.speaker === speaker);
	if (updated?.pending.length && JSON.stringify(updated.pending) === JSON.stringify(names))
		await profiles.confirm(group, speaker, updated.version);
	const saved = (await profiles.list(group)).find((p) => p.speaker === speaker);
	return JSON.stringify(saved?.names) === JSON.stringify(names)
		? `あなたの名前・呼び名を登録しました: ${names.join("・")}`
		: "プロフィールの上限に達しました。不要な情報を削除してください。";
}

export async function manageProfile(
	command: ProfileCommand,
	input: {
		group: string;
		speaker: string | undefined;
		messageId: string | undefined;
		occurredAt: number;
	},
	profiles: FamilyProfiles,
	memory: { clear(): Promise<void>; forget(ids: string[]): Promise<void> },
): Promise<string> {
	const { group, speaker, messageId, occurredAt } = input;
	const rows = await profiles.list(group);
	if (command.type === "list")
		return (
			rows.map((p) => describeProfile(p, speaker)).join("\n\n") || "プロフィールは未登録です。"
		);
	if (command.type === "clear") {
		await memory.clear();
		await profiles.clear(group);
		return "会話・要約・長期記憶・家族プロフィールを削除しました。登録した通知・収集設定・共有リストとLINE上のメッセージは残ります。";
	}
	if (!speaker || !/^U[0-9a-f]{32}$/.test(speaker)) return "本人の発言者IDを確認できませんでした。";
	if (command.type === "remove") {
		await memory.forget(rows.find((p) => p.speaker === speaker)?.sourceIds ?? []);
		await profiles.remove(group, speaker);
		return "あなたのプロフィールと根拠の発言・派生記憶を削除しました。";
	}
	if (command.type === "confirm")
		return (await profiles.confirm(group, speaker, command.version))
			? "あなたのプロフィールを確定しました。"
			: "確認待ちの版が変わったか、候補がありません。プロフィール一覧で確認してください。";
	if (command.type === "register" && messageId)
		return registerProfile(profiles, group, speaker, command.names, messageId, occurredAt);
	return "本人の発言者IDを確認できませんでした。";
}
