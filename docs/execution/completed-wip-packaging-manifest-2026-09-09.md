# Completed WIP Packaging Manifest - 2026-09-09

## Packaging decision

- Base commit: `c8b269aabd7a29c603e7ae39b87b606068308164`.
- Packaging branch: `codex/package-completed-wip-2026-09-09`.
- Packaging worktree: `C:\DUY - DoWorks\Tool_TTS-boss-merge-package-2026-09-09`.
- Source worktree: `C:\DUY - DoWorks\Tool_TTS-boss-merge`; it was used as a read-only source during packaging.
- The source worktree was not reset, staged, committed, or cleaned during this pass.
- The package contains exactly seven business-meaningful commits. No tag, push, merge, or branch deletion is part of this pass.
- Files were staged from this manifest and explicit path lists. `git add .` was not used.

## Commit chain

| # | Commit | Scope |
| --- | --- | --- |
| 1 | `82d6cb083839ca41baeba479fca7deedec7383e9` | Repository guardrails and secret/local-artifact protection |
| 2 | `0b5502ec42496be0219340023e8c2ac712843069` | W21/Cotik domain and persistence foundations |
| 3 | `84c410048c13a9e4ea0ca82217b8f7661fd6b49f` | Cotik multi-account sync and controlled tracking workflow |
| 4 | `1109b5b9fa0ae85c049a63bbd298c2f71cd80c63` | Auto-tracking v1.0 |
| 5 | `59ce223` | Gmail tracking extraction and Sheet sync |
| 6 | `2d67df6` | Dashboard and Cotik controls consolidation |
| 7 | this commit | Acceptance documents and this manifest |

## Included files by commit

### Commit 1 - repository guardrails

- `.env.example`
- `.gitignore`
- `AGENTS.md`
- `CLAUDE.md`

The guardrails keep the dual Cotik kill switch OFF by default, reset it on a new deployment, protect `OauthGoogle/**/*.json`, and ignore local agent/browser/scratch artifacts. Generated `.js`, `.d.ts`, and `.map` files next to TypeScript sources are intentionally not ignored.

### Commit 2 - W21 persistence foundations

- `packages/domain` Cotik observation/provider contracts, deterministic matching, and exports.
- `packages/db` Cotik accounts, logical shops, observations, provider catalog, workflow settings, orders, tracking candidates/intents, schema, queries, locks, tests, and exports.
- Drizzle migrations `0042_numerous_black_knight.sql` through `0046_w21_persistence_corrective.sql`.
- Matching snapshots `0042_snapshot.json` through `0046_snapshot.json` and the migration journal.

The duplicate `0045_cotik_account_status_expand.sql` is excluded. The package keeps only journaled `0045_omniscient_santa_claus.sql`. Migration `0047` belongs to commit 4.

### Commit 3 - controlled Cotik workflow

- `packages/cotik` client, account discovery, provider catalog, multi-account client/order sync, tracking writer, POST/readback tests.
- `packages/sync` Cotik multi-account synchronization and initial Sheet staging boundary.
- `apps/worker` Cotik scheduler/cycle, deployment reset, lock-controlled tracking cycle, and tests.
- `apps/cli` Cotik account/manual tracking commands, contracts, configuration, and tests.
- Dashboard Cotik account/settings/control routes that belong to the controlled workflow.
- AdsPower tag normalization boundary and shop display-name/unlink helpers required by the existing profile/settings flow.
- `pnpm-lock.yaml` changes required by the W21 workspace dependency graph.

Manual `cotik-tracking stage --shop-id` remains a supported diagnostic/manual command. No live POST was run as part of packaging.

### Commit 4 - auto-tracking v1.0

- Auto-tracking CLI contracts/workflow and `scripts/auto-tracking.mts`.
- Sheet date staging/reconciliation and tracking-run persistence, including `run_id`, per-run fingerprints, and explicit replay source.
- Worker-cycle, tracking-writer, DB query/schema, and CLI tests required by the auto-tracking path.
- `packages/db/migrations/0047_tricky_marten_broadcloak.sql`, its snapshot, and the journal update.
- `scripts/test-cotik-tracking.ps1` as the bounded verification helper.
- `package.json` entry `auto-tracking` only.
- `docs/execution/auto-tracking-capability.md` initial capability contract.

`stage-sheet-date` does not use `--shop-id`; it reads account/shop from the Sheet and resolves the logical shop. Scheduler support is intentionally not included in v1.0.

### Commit 5 - Gmail to Sheet pipeline

- `scripts/email-order-extractor.mts`
- `scripts/gmail-api-reader.mts`
- `scripts/sync-shein-sheets.mts`
- `scripts/exchange-gmail-token.mts`
- `scripts/email-order-extractor.test.ts`
- `vitest.config.ts` inclusion for `scripts/**/*.test.ts`
- `package.json` entries `sync:shein-sheets` and `sync:shein-sheets:schedule`

The extractor test is outside `packages/sync/src`, so the package typecheck no longer imports an `.mts` script outside its `rootDir`. Gmail extraction and auto-tracking remain independent features with independent schedules.

### Commit 6 - Dashboard consolidation

- The final tracked and untracked Dashboard implementation under `apps/dashboard`, including routes, settings, shops, orders, operations, landing pages, theme/assets, and tests.
- `scripts/audit-dom-ux.ts` and `scripts/capture-ui-screenshots.ts`.
- The 30 approved screenshots under `docs/screenshots/ui-consolidation/`.
- `apps/dashboard/lib/dashboard-read.integration.test.ts` is deleted because the current project uses Supabase and the disposable `TEST_DATABASE_URL` integration gate is no longer part of the accepted Dashboard test boundary.

The approved screenshot set contains 30 PNG files and totals 6,565,060 bytes (approximately 6.26 MiB). No root-level trial PNG is included.

### Commit 7 - acceptance and documentation

- `README.md`, with the COTIK tracking-write exception described as controlled by `AGENTS.md` rather than incorrectly prohibited wholesale.
- `CURRENT_IMPLEMENTATION_STATUS.md`, retained as historical implementation evidence rather than current operational authority.
- `docs/execution/tool-tts-v1-execution-ledger.md`, using the final W21/live-acceptance wording.
- `docs/execution/w21-tracking-acceptance-2026-09-07.md`, recording the operator-confirmed `LIVE ACCEPTED` state.
- `docs/execution/auto-tracking-capability.md`, with the Sheet-driven shop resolution example.
- This file: `docs/execution/completed-wip-packaging-manifest-2026-09-09.md`.

## Explicit exclusions

| Excluded item | Reason |
| --- | --- |
| `packages/db/migrations/0045_cotik_account_status_expand.sql` | Duplicate migration number; not present in the journal. |
| Migration `0047` from commits 1-3 | It is packaged only with the auto-tracking release in commit 4. |
| `scripts/playwright-chrome-session.mts` | Manual experiment tool, not part of the Gmail-to-Sheet pipeline. |
| `scripts/email-order-extractor.mjs`, `scripts/email-order-extractor.d.mts`, `scripts/email-order-extractor.mjs.map` | Generated artifacts; source is the `.mts` file. |
| `packages/domain/src/**/*.js`, `*.d.ts`, and `*.map` generated beside TypeScript | Generated source artifacts; TypeScript remains authoritative. |
| `apps/dashboard/lib/dashboard-read.integration.test.ts` | Removed from the accepted Dashboard boundary; it depends on `TEST_DATABASE_URL`. |
| 30 root-level trial PNG files | Wrong location and approximately 22.44 MiB of exploratory output. |
| `.playwright-mcp/**/*.png`, `output/playwright/*` except existing approved output rules | Local browser/tool captures, not product evidence for this package. |
| `TOOL_TTS_DEEPSEEK_HARNESS_CONTEXT.md` | Historical context prompt, not current operational documentation. |
| `Tool_TTS_V1_Master_Prompt_revised.md` | Historical prompt, not current operational documentation. |
| `docs/execution/ui-consolidation-codex-review-handoff.md` | Review handoff scratch/context, not part of the seven-commit package scope. |
| `.env`, `OauthGoogle/**/*.json`, OAuth client secrets, Gmail tokens, Gmail state, cookies, and database backups | Secrets, credentials, runtime state, or backups; never version-controlled. |
| `scratch/`, `scripts/script_test/`, `backups/`, `database-dumps/`, and local agent/browser folders | Local experiments or runtime artifacts outside the product boundary. |

## Verification recorded during packaging

- Commit 2 focused verification: 28 test files, 339 tests passed.
- Commit 3 focused verification: 16 test files, 135 tests passed; AdsPower/profile boundary regression: 25 tests passed.
- Commit 4 focused verification: 9 test files, 113 tests passed.
- Commit 5 focused verification: 1 test file, 4 tests passed.
- Commit 6 Dashboard verification: 41 test files, 238 tests passed, 0 skipped.
- `git diff --cached --check` was required before each commit. The final commit-6 staging check contained only Dashboard/UI paths, approved screenshots, and the deliberate integration-test deletion.
- `pnpm install --frozen-lockfile`: PASS; workspace dependencies were already up to date.
- `pnpm typecheck`: PASS across the workspace, including Dashboard route type generation.
- `pnpm test`: PASS with 150 test files and 1,304 tests passed; 18 database-dependent test files and 73 tests were skipped because the target worktree intentionally has no `.env`/`TEST_DATABASE_URL`.
- `pnpm build`: PASS across packages, apps, Dashboard production build, and CLI postbuild help.
- `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts`: PASS.
- The obsolete `shop-health doctor` command was removed after packaging because the AdsPower health-check flow is no longer used. No replacement diagnostic command was added.
- Dashboard-only verification: PASS with 41 test files, 238 tests passed, and 0 skipped.
- Repository-wide stale W21 acceptance-wording scan: PASS; no outdated not-live status remains.
- Git hygiene scan: PASS for OAuth JSON, Gmail token/state, generated extractor artifacts, trial root PNGs, and local scratch/tool folders; approved existing `output/playwright` and Dashboard runtime assets remain intentional.

## Initial read-only database preflight result

- The database was inspected without writing through the environment kept in the source worktree; no secret value was printed or copied into this worktree.
- The inspected database has a Drizzle journal with 48 entries, already has `cotik_tracking_runs`, and contains 267 candidates and 267 intents with zero missing `run_id` values.
- Before the handoff, the inspected workflow row had `cotikSyncEnabled=true` and `cotikPostEnabled=true`, with a deployment ID present.
- These facts did not satisfy the planned migration gate requiring a database exactly through `0046` with both switches OFF. The preflight therefore stopped before backup, `pnpm db:migrate`, or any migration write.
- The packaging process did not enable either switch and did not perform a live Cotik POST. The switch state was changed to OFF later during the explicit workspace handoff below.

## Database and workspace handoff

- The database journal already contained migration `0047_tricky_marten_broadcloak` and `cotik_tracking_runs` already existed, so `pnpm db:migrate` was not run again.
- On 2026-09-09, `cotik_sync_enabled` and `cotik_post_enabled` were updated in one transaction to `false`; readback confirmed one workflow row with both switches OFF.
- The external backup is at `C:\DUY - DoWorks\Tool_TTS-boss-merge-db-backup\2026-09-09-0047`.
- The backup contains candidates, intents, tracking runs, workflow settings, the migration journal, schema/index/constraint metadata, backup metadata, and `SHA256SUMS.txt`.
- Backup readback recorded 267 candidates, 267 intents, zero missing `run_id` values, two tracking runs including the legacy run, and migration `0047` present in the journal.
- No migration write or live Cotik POST was performed during this handoff.
- The original WIP is preserved in the Git stash `recovery/pre-package-2026-09-09`; ignored local OAuth and fixture artifacts are preserved separately in `recovery/pre-package-2026-09-09-local-artifacts` and are not part of the branch history.
- The packaging worktree was removed after verification, and `C:\DUY - DoWorks\Tool_TTS-boss-merge` now runs `codex/package-completed-wip-2026-09-09`.

## Post-packaging cleanup

- Commit `chore(cli): remove obsolete health doctor` removes the unused AdsPower health-check command and its tests.
- Current CLI guidance no longer advertises `shop-health doctor`.
