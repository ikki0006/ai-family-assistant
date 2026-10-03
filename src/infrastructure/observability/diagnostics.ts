import type { Diagnostics } from "../../application/ports/diagnostics";

export const diagnostics: Diagnostics = {
	failure(code, upstreamStatus) {
		// Only fixed codes and HTTP status numbers; never pass requests or Error objects.
		console.error(JSON.stringify({ event: code, upstreamStatus }));
	},
};
