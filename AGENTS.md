# TikTok Shop Health - Codex Rules

## Scope

Build and maintain the backend-first TikTok Shop Health collector and deterministic risk CLI, as well as V1 Dashboard/settings and W21 Cotik multi-account fulfillment foundations. Preserve boundaries:
- Cotik tracking write is permitted ONLY under STRICT CONTROL via the dual kill switch (`cotikPostEnabled` in `cotik_workflow_settings`).
- Kill switch defaults to OFF and resets to OFF on every new deployment; automatic enabling of the kill switch in production is strictly forbidden.
- CONTINUED PROHIBITIONS: No LLM/AI authority over business decisions or automated actions; no Seller Center writes of any kind; no automatic price, stock, promotion, or listing mutations in Seller Center or COTIK; no Holiday Mode automation.

## Architecture

- `apps/cli`: Commander CLI and presentation.
- `apps/worker`: polling scheduler and dry-run risk evaluation.
- `packages/domain`: pure contracts, metrics, recommendations, reports, and risk policy.
- `packages/db`: PostgreSQL/Drizzle schema, migrations, locks, and queries.
- `packages/seller-center`: AdsPower/CDP extraction and normalization.
- `packages/sync`: synchronization orchestration and persistence boundaries.

Keep extraction, normalization, persistence, domain decisions, and presentation separate. Domain logic must not depend on browser or database implementations.

## Commands

- Install: `pnpm install`
- Typecheck: `pnpm typecheck`
- Test: `pnpm test`
- Build: `pnpm build`
- Schema check: `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts`

## Engineering Rules

- Use Node.js 22+, pnpm, strict TypeScript, ESM, and existing workspace package boundaries.
- Make surgical changes; do not refactor unrelated code.
- For bugs and behavior changes, reproduce with a test before implementing when practical.
- Preserve deterministic business rules. Do not add heuristic or LLM-based risk decisions.
- Treat unknown statuses, currencies, incomplete history, login challenges, and layout changes as explicit insufficient/paused states; never silently infer safe data.
- Store timestamps in UTC and keep display-time-zone conversion in presentation code.
- Never persist cookies, tokens, browser storage, buyer names, contact details, or shipping addresses.
- Never enable/disable Holiday Mode or perform another Seller Center write without explicit user authorization and an approved, auditable implementation.
- Cotik tracking write operations are allowed ONLY when: (1) kill switch `cotikPostEnabled` is explicitly true; (2) tracking resolves to a MATCHED carrier rule in `cotik_provider_rules`; (3) intents are fingerprinted and confirmed by readback; (4) max 3 attempts per intent; (5) max 50 orders per batch; (6) kill switch resets to OFF upon every new deployment. AI must never decide or trigger writes; automatic enabling of kill switch is prohibited.
- Database schema changes require a Drizzle migration and schema validation.
- Run the narrowest relevant tests during iteration, then typecheck, full tests, and build before claiming completion.

## Project Skills

Skills live in `.agents/skills`. Use only skills whose trigger matches the task. `.agents/vendor` contains upstream reference repositories and is not an auto-loaded skill directory.

- Use `karpathy-guidelines` for implementation/review discipline.
- Use `systematic-debugging` for failures or unexpected behavior.
- Use `test-driven-development` for features and bug fixes.
- Use `verification-before-completion` before completion claims.
- Use `api-and-interface-design` for public contracts and module boundaries.
- Use `codebase-design` when improving module depth, seams, and testability without broad refactoring.
- Use `nodejs-backend-patterns` for CLI/worker lifecycle, configuration, logging, and resource management.
- Use `supabase-postgres-best-practices` for PostgreSQL schema, query, index, locking, and migration work; this project uses PostgreSQL directly, not the Supabase platform.
- Use `playwright-best-practices` for AdsPower/CDP collection logic and browser integration tests.
- Use `adspower-browser` for AdsPower profile operations.

Plans for this repository default to `docs/plans/` unless an explicit specification/project contract selects another location.

Do not require subagents unless the user explicitly requests delegation or parallel agent work.
