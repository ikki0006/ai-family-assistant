if (!process.env.npm_config_user_agent?.startsWith("pnpm/")) {
	process.stderr.write("このリポジトリでは pnpm install を使ってください。\n");
	process.exitCode = 1;
}
