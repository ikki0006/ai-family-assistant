import type { FamilyTask, TaskState } from "../../domain/tasks/task";
export interface FamilyTasks {
	load(group: string): Promise<TaskState>;
	applied(group: string, event: string): Promise<boolean>;
	save(group: string, event: string, previous: TaskState, tasks: FamilyTask[]): Promise<boolean>;
}
