export interface FamilyProfile {
	speaker: string;
	names: string[];
	pending: string[];
	sourceIds: string[];
	version: number;
}
export interface ProfileProposal {
	occurredAt: number;
	speaker: string;
	names: string[];
	sourceIds: string[];
}
export interface FamilyProfiles {
	list(group: string): Promise<FamilyProfile[]>;
	propose(group: string, proposal: ProfileProposal): Promise<void>;
	confirm(group: string, speaker: string, version: number): Promise<boolean>;
	removeSources(group: string, ids: string[]): Promise<void>;
	remove(group: string, speaker: string): Promise<void>;
	clear(group: string): Promise<void>;
}
