# Repository instructions

- Architecture decisions live in `docs/adr/`. Read the relevant ADR before changing a layer boundary.
- Use pnpm. Do not create npm or Yarn lockfiles.
- Use `src/presentation/router` for HTTP handlers.
- Application code must not depend on framework, runtime, or AI SDK types. DB access belongs in repositories. There is no separate domain layer; see ADR-0005 for the planned inferred database types.
- Put layer-independent shared definitions in `src/core`. Core must not depend on other layers or external packages. Future domain code may depend on core; application may depend on domain and core.
- Wire concrete implementations in `src/bootstrap` using explicit dependency injection.
- Implement small vertical slices. The current slice is seven-day conversation memory with Agents Sessions, contextual Workers AI replies, and scheduled garbage reminders for one allowed family group. All inference must use the budget-controlled AI Gateway. D1 stores deduplication IDs and collection configuration; never commit household schedule data or addresses. Conversation models live in application/conversation; default prompts live in application/prompts. Sessions and runtime dependencies remain in adapters/bootstrap. Long-term memory comes later.
- Use `pnpm check` for read-only checks and `pnpm fix` for explicit fixes.
- Before delivering executable changes, run `pnpm verify` when dependencies are available and report any unavailable checks.
- Keep real conversations, credentials, Terraform state, and local environment files out of Git.
