export interface ListItem {
	id: string;
	text: string;
	note: string;
}
export interface FamilyList {
	id: string;
	name: string;
	aliases: string[];
	items: ListItem[];
}
export interface ListState {
	version: number;
	lists: FamilyList[];
}
export interface FamilyLists {
	load(group: string): Promise<ListState>;
	applied(group: string, event: string): Promise<boolean>;
	save(group: string, event: string, previous: ListState, lists: FamilyList[]): Promise<boolean>;
}
