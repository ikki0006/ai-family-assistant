export type FailureCode =
	| "llm_rate_or_budget_limited"
	| "garbage_reminder_failed"
	| "line_not_configured"
	| "invalid_signature"
	| "invalid_payload"
	| "reply_failed"
	| "line_api_failed"
	| "line_auth_failed"
	| "line_transport_failed"
	| "internal_error"
	| "generation_job_failed"
	| "llm_not_configured"
	| "llm_auth_failed"
	| "llm_api_failed"
	| "llm_generation_failed"
	| "llm_empty_response"
	| "llm_timeout";

export type ConfigurationIssue =
	| "missing_channel_secret"
	| "missing_access_token"
	| "invalid_group_id";
