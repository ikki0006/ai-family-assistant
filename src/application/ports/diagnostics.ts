export type FailureCode =
	| "line_not_configured"
	| "invalid_signature"
	| "invalid_payload"
	| "reply_failed"
	| "line_api_failed"
	| "line_auth_failed"
	| "line_transport_failed"
	| "internal_error";

export type ConfigurationIssue =
	| "missing_channel_secret"
	| "missing_access_token"
	| "invalid_group_id";

export interface Diagnostics {
	groupSetup(groupId: string): void;
	failure(code: FailureCode, upstreamStatus?: number, issues?: ConfigurationIssue[]): void;
}
