import type { ConfigurationIssue, FailureCode } from "../../core/diagnostics";

export interface Diagnostics {
	groupSetup(groupId: string): void;
	failure(code: FailureCode, upstreamStatus?: number, issues?: ConfigurationIssue[]): void;
}
