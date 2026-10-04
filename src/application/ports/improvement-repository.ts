export type Improvement = {
	id: string;
	groupId: string;
	specification: string;
	version: number;
	status: "pending" | "dispatching" | "dispatched" | "uncertain";
};
export interface ImprovementRepository {
	create(groupId: string, eventId: string, specification: string): Promise<Improvement>;
	get(groupId: string, id: string): Promise<Improvement | null>;
	claim(groupId: string, id: string, version: number): Promise<boolean>;
	finish(groupId: string, id: string, status: "dispatched" | "uncertain"): Promise<void>;
}
export interface ImprovementDispatcher {
	dispatch(request: Improvement): Promise<void>;
}
