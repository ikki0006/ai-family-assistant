/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{ name: "no-circular", severity: "error", from: {}, to: { circular: true } },
		{
			name: "no-unresolved",
			severity: "error",
			from: {},
			to: { couldNotResolve: true, pathNot: "^cloudflare:workers$" },
		},
		{
			name: "application-depends-on-core-only",
			severity: "error",
			from: { path: "^src/application/" },
			to: { pathNot: "^src/(application|core|domain)/" },
		},
		{
			name: "core-is-independent",
			severity: "error",
			from: { path: "^src/core/" },
			to: { pathNot: "^src/core/" },
		},
		{
			name: "domain-depends-on-core-only",
			severity: "error",
			from: { path: "^src/domain/" },
			to: { pathNot: "^src/(domain|core)/" },
		},
		{
			name: "ports-do-not-depend-on-use-cases",
			severity: "error",
			from: { path: "^src/application/ports/" },
			to: { path: "^src/application/(?!ports/|conversation/conversation\\.ts$)" },
		},
		{
			name: "presentation-does-not-construct-adapters",
			severity: "error",
			from: { path: "^src/presentation/" },
			to: { path: "^src/(infrastructure|bootstrap)/" },
		},
		{
			name: "infrastructure-implements-ports",
			severity: "error",
			from: { path: "^src/infrastructure/" },
			to: {
				path: "^src/(presentation|bootstrap)/|^src/application/(?!ports/|conversation/conversation\\.ts$)",
			},
		},
		{
			name: "entrypoint-is-not-importable",
			severity: "error",
			from: { path: "^src/" },
			to: { path: "^src/index\\.ts$" },
		},
	],
	options: {
		enhancedResolveOptions: {
			exportsFields: ["exports"],
			conditionNames: ["import", "types", "default"],
		},
		doNotFollow: { path: "node_modules" },
		tsPreCompilationDeps: true,
		tsConfig: { fileName: "tsconfig.json" },
	},
};
