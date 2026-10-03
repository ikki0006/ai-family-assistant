import type { Diagnostics } from "../../application/ports/diagnostics";

export const diagnostics: Diagnostics = {
	groupSetup(groupId) {
		if (!/^C[0-9a-f]{32}$/.test(groupId)) return;
		console.info(JSON.stringify({ event: "group_setup_required", groupId }));
	},
	failure(code, upstreamStatus, issues) {
		// Only fixed codes, configuration issue names, and HTTP status numbers; never pass requests or Error objects.
		console.error(JSON.stringify({ event: code, upstreamStatus, issues }));
	},
};
