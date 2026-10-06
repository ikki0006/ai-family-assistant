import type { FamilyLists, ListState } from "../ports/family-lists";
export type ListAction = {
	op: "show" | "create" | "rename" | "delete" | "add" | "edit" | "remove";
	listId?: string;
	itemId?: string;
	name?: string;
	text?: string;
	note?: string;
	page?: number;
};
export function parseListAction(value: unknown): ListAction {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid list action");
	const v = value as Record<string, unknown>;
	if (!["show", "create", "rename", "delete", "add", "edit", "remove"].includes(String(v.op)))
		throw new Error("Invalid list operation");
	for (const [key, max] of [
		["listId", 256],
		["itemId", 256],
		["name", 40],
		["text", 100],
		["note", 300],
	] as const)
		if (v[key] !== undefined && (typeof v[key] !== "string" || (v[key] as string).length > max))
			throw new Error("Invalid list field");
	if (
		v.page !== undefined &&
		(!Number.isInteger(v.page) || Number(v.page) < 1 || Number(v.page) > 20)
	)
		throw new Error("Invalid list page");
	return v as ListAction;
}
export function listNameKey(name: string) {
	return name
		.normalize("NFKC")
		.replace(/(?:行って|言って)みたい/g, "行きたい")
		.replace(/お店/g, "店")
		.replace(/\s/g, "")
		.toLowerCase();
}
export async function manageLists(
	repo: FamilyLists,
	group: string,
	event: string,
	action: ListAction,
	expectedVersion: number,
	confirmedDelete = false,
): Promise<{ text: string; confirm?: { listId: string; version: number } }> {
	const state = await repo.load(group);
	if (action.op !== "show" && (await repo.applied(group, event)))
		return { text: "このリスト操作は反映済みです。" };
	if (action.op !== "show" && state.version !== expectedVersion)
		return { text: "リストが更新されました。内容を確認して、もう一度お願いします。" };
	const lists = state.lists.map((l) => ({
		...l,
		aliases: [...l.aliases],
		items: l.items.map((i) => ({ ...i })),
	}));
	let list = lists.find((l) => l.id === action.listId);
	const named = action.name?.trim();
	const text = action.text?.trim();
	const save = async (message: string) => ({
		text: (await repo.save(group, event, state, lists))
			? message
			: "リストが更新されました。もう一度お願いします。",
	});
	if (action.op === "show") return { text: renderLists(state, action.listId, action.page ?? 1) };
	if (
		(action.op === "add" || (action.op === "create" && text)) &&
		lists.reduce((sum, l) => sum + l.items.length, 0) >= 200
	)
		return { text: "共有リスト全体で200件までです。不要な項目を削除してください。" };
	if (action.op === "create") {
		if (!named) return { text: "リストの名前を教えてください。" };
		const duplicate = lists.find((l) =>
			[l.name, ...l.aliases].some((n) => listNameKey(n) === listNameKey(named)),
		);
		if (duplicate)
			return { text: `「${duplicate.name}」はすでにあります。このリストを使ってください。` };
		if (lists.length >= 20)
			return { text: "リストは20個までです。不要なリストを削除してください。" };
		list = { id: `list:${event}`, name: named, aliases: [], items: [] };
		lists.push(list);
		if (text) list.items.push({ id: `item:${event}`, text, note: action.note?.trim() ?? "" });
		return save(`「${named}」を作りました。${text ? `\n「${text}」を追加しました。` : ""}`);
	}
	if (!list) return { text: "対象のリストを確認できませんでした。リスト名を教えてください。" };
	if (action.op === "delete") {
		if (!confirmedDelete)
			return {
				text: `「${list.name}」をリストごと削除しますか？中の${list.items.length}件も削除されます。`,
				confirm: { listId: list.id, version: state.version },
			};
		lists.splice(lists.indexOf(list), 1);
		return save(`「${list.name}」を削除しました。`);
	}
	if (action.op === "rename") {
		if (!named) return { text: "新しいリスト名を教えてください。" };
		if (
			lists.some(
				(l) =>
					l.id !== list.id &&
					[l.name, ...l.aliases].some((n) => listNameKey(n) === listNameKey(named)),
			)
		)
			return { text: "同じ名前・呼び名のリストがあります。別の名前にしますか？" };
		list.aliases = [...new Set([...list.aliases, list.name])].filter((n) => n !== named).slice(-5);
		list.name = named;
		return save(`リスト名を「${named}」に変更しました。`);
	}
	if (action.op === "add") {
		if (!text) return { text: "追加する項目を教えてください。" };
		if (list.items.some((i) => listNameKey(i.text) === listNameKey(text)))
			return { text: `「${text}」は「${list.name}」に登録済みです。` };
		if (list.items.length >= 50)
			return { text: "1リストは50件までです。不要な項目を削除してください。" };
		list.items.push({ id: `item:${event}`, text, note: action.note?.trim() ?? "" });
		return save(`「${list.name}」に「${text}」を追加しました。`);
	}
	const item = list.items.find((i) => i.id === action.itemId);
	if (!item) return { text: "対象の項目が見つかりません。どの項目か教えてください。" };
	if (action.op === "remove") {
		list.items.splice(list.items.indexOf(item), 1);
		return save(`「${list.name}」から「${item.text}」を削除しました。`);
	}
	if (!text && action.note === undefined) return { text: "変更する内容を教えてください。" };
	if (text && list.items.some((i) => i.id !== item.id && listNameKey(i.text) === listNameKey(text)))
		return { text: "同じ項目が登録済みです。どちらを残すか確認してください。" };
	if (text) item.text = text;
	if (action.note !== undefined) item.note = action.note.trim();
	return save(`「${list.name}」の「${item.text}」を更新しました。`);
}
export function renderLists(state: ListState, id?: string, page = 1) {
	if (!id)
		return state.lists.length
			? `共有リスト\n${state.lists.map((l) => `・${l.name}（${l.items.length}件）`).join("\n")}`
			: "共有リストはまだありません。";
	const list = state.lists.find((l) => l.id === id);
	if (!list) return "対象のリストが見つかりません。";
	const items = list.items.slice((page - 1) * 4, page * 4);
	return `「${list.name}」${list.items.length}件\n${items.map((i, n) => `${(page - 1) * 4 + n + 1}. ${i.text}${i.note ? `：${i.note}` : ""}`).join("\n") || "このページには項目がありません。"}\n${page}/${Math.max(1, Math.ceil(list.items.length / 4))}ページ${page * 4 < list.items.length ? "（続きを聞いてください）" : ""}`;
}
