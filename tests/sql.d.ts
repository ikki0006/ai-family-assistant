declare module "*.sql?raw" {
	const sql: string;
	// biome-ignore lint/style/noDefaultExport: Vite raw imports expose a default string.
	export default sql;
}
