// Liveness only: no database access or provider calls.
export function getHealth() {
	return { status: "ok" as const, service: "ai-family-assistant" };
}
