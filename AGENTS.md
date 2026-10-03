# Repository instructions

- Architecture decisions live in `docs/adr/`. Read the relevant ADR before changing a layer boundary.
- Use pnpm. Do not create npm or Yarn lockfiles.
- Use `src/presentation/router` for HTTP handlers.
- Application code must not depend on framework, runtime, or AI SDK types. DB access belongs in repositories. There is no separate domain layer; see ADR-0005 for the planned inferred database types.
- Wire concrete implementations in `src/bootstrap` using explicit dependency injection.
- Implement small vertical slices. The current slice is a mention-based LINE ping/pong connection check with owner setup and a group allowlist; memory and LLM features come later.
- Use `pnpm check` for read-only checks and `pnpm fix` for explicit fixes.
- Before delivering executable changes, run `pnpm verify` when dependencies are available and report any unavailable checks.
- Keep real conversations, credentials, Terraform state, and local environment files out of Git.
