export interface CollectionRule {
	label: string;
	weekday: number;
	weeks?: number[];
}
export interface GarbageSchedule {
	validFrom: string;
	validThrough: string;
	rules: CollectionRule[];
	// A date overrides ALL normal rules. [] explicitly means no collection.
	overrides: Record<string, string[]>;
}
export interface GarbageScheduleStore {
	load(): Promise<GarbageSchedule | null>;
}
export interface ReminderLedger {
	wasSent(key: string): Promise<boolean>;
	markSent(key: string, sentAt: number): Promise<void>;
}
