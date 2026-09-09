# W21 tracking review closure - 2026-09-07

## Acceptance boundary

Status: CODE VERIFIED / CROSS-REVIEW COMPLETE / SUPABASE DB APPLIED / LIVE POST VERIFIED / LIVE ACCEPTED.

The accepted design is `docs/plans/2026-09-07-w21-review-closure.md`. The current review overrides the original W21 winner ordering: active, discovered accounts with an observed order are ranked by account lastSeenAt, not order update time.

## Supabase DB evidence - 2026-09-07

- The runtime `DATABASE_URL` now targets the new Supabase PostgreSQL project; the local source connection is preserved only as `SOURCE_DATABASE_URL` in the ignored local `.env`. No connection string, password, API key or token is recorded here.
- A custom-format source backup and a data-only backup were created under ignored `backups/` before changing the target.
- Supabase migration execution completed with 47 journal entries and 36 public tables, including all W21 tables. The target migration run exposed and then fixed the root ordering defect in `0042_numerous_black_knight.sql`: the provider catalog unique index now exists before the foreign key that references it. The regression test is included in `cotik-accounts.migration.test.ts`.
- Exact row-count parity was verified for all 23 source tables: shops 46, orders 971, settlements 110, sync runs 99, financial snapshots 15, and the remaining source tables matched as well. W21-only tables are present and empty because the source database predates W21 onboarding.
- Source refresh settings/checkpoints were restored without accepting the migration seed conflict: source has one settings row and two checkpoints (`11:00`, `17:00`), and Supabase matches those rows.
- Supabase workflow state is fail-closed: both `cotikSyncEnabled` and `cotikPostEnabled` are `false`; no deploy version is active.
- One legacy sanitized finance row has a non-SHA snapshot hash; its existing check remains `NOT VALID` after restore, matching the source legacy state. It is recorded as a data-quality exception, not silently rewritten.
- W21 operational rows are still empty on Supabase for accounts, discovered logical shops, observations, candidates and intents. The explicit provider catalog is now seeded with 7 active entries (4 US, 3 UK); GUI staging still fails closed until account onboarding and discovery are completed.

## Operational contract

- Stage is database preparation, not proof of transmission. It works while switches are OFF. If both switches are ON and the worker is running, staged eligible intents may be transmitted on a later cycle.
- Staging requires an existing numeric logical-shop identity, matching explicit US/UK region, observed Cotik order, usable discovered account and an active provider catalog entry matching the operator-supplied provider value. Provider resolution normalizes case/punctuation only; it never infers a carrier from tracking prefix, length, or an alias. Unknown or conflicting evidence returns PAUSED. Tracking writes accept only the explicit Cotik statuses `AWAITING_SHIPMENT`, `AWAITING_COLLECTION`, or `NEW`; unknown statuses remain paused.
- Worker is connected to the production scheduler only when `COTIK_DEPLOY_VERSION` is supplied. Use a unique immutable version for each deployment; do not reuse the previous release version. A new version resets both persisted switches OFF. Manual runs do not require this variable; the kill switches still control POST processing.
- POST has no transport retries. Reservation and confirmation are separate: reserved budget is conservative, and uncertain outcomes are not proof that the server did nothing.
- The Sheets contract is fixed: `A` is creation date, `B` is the Cotik OrderID sent to Cotik, `Y` is the Shein dropship order ID and is never sent to Cotik, `Z` is tracking (`Y` present with blank `Z` means not ready), `AC` is the operator-entered provider, and `W` is result/readback writeback only when blank. The date-scoped adapter reads the explicit tab/range, preserves absolute row numbers, stages only rows with B/Z/AC and blank W, and performs W read-before/write/readback checks. The manual live auto-tracking flow has been verified; scheduled execution remains separate follow-up work.
- `GOOGLE_SHEETS_ACCESS_TOKEN` is supplied through the process environment by the operator/secret manager. Do not put tokens in command arguments, evidence or Git. Existing DPAPI OAuth credentials are not exported automatically; this adapter does not claim refresh-token lifecycle support.
- Vault runtime rotation uses `COTIK_VAULT_KEYS_JSON`, a JSON array of objects with `keyId`, positive integer `version`, and `hex` (64 hex characters). Select the active write key with both `COTIK_VAULT_KEY_ID` and `COTIK_VAULT_KEY_VERSION`; decrypt selects the recorded pair. Without a keyring, legacy v1/1 uses `COTIK_VAULT_KEY`. With a keyring, the selected entry must exist even for v1/1; there is no silent fallback to another key. Preserve historical keys until old secrets are deliberately rotated. Never put real key values in documentation.
- Incomplete discovery invalidates old links and marks health UNKNOWN. Scheduled/manual read-only discovery may retry UNKNOWN, NETWORK_ERROR, RATE_LIMITED and SHOP_DISCONNECTED; it never retries DISABLED/BLOCKED/token-expired accounts automatically. Successful complete discovery can restore health but never changes either kill switch.
- Account lastSeenAt is refreshed after successful observation persistence and before projection. Winner-sourced item provenance is explicit.
- Worker checks live exact order readiness before reservation, rechecks persisted routing/provider/switch evidence after transport queue pacing, and confirms through a separate status-independent readback. IN_PROGRESS uncertain results never automatically resend. Known no-send guard failures are ABORTED with conservatively consumed reservation budget; operational recovery is an explicit manual review, not automatic retry.
- Dashboard is loopback-only. Its local/origin guard is not general user authentication: do not expose it through a public/non-loopback proxy without separate authentication work.

## Safe operator command templates

These are templates only, not commands executed for live data in this review. Even staging can lead to later sends if an operator already enabled the worker; inspect both switches before preparing data.

```text
pnpm shop-health cotik-tracking kill-switch status --json
pnpm shop-health cotik-tracking providers list --region US --json
pnpm shop-health cotik-tracking stage-sheet-date --spreadsheet-id <id> --tab <exact-title> --range A1:AC2000 --shop-id <logical-shop-uuid> --region US --target-date 2026-09-04 --json
pnpm shop-health cotik-tracking reconcile-sheet-date --spreadsheet-id <id> --tab <exact-title> --range A1:AC2000 --shop-id <logical-shop-uuid> --region US --target-date 2026-09-04 --json
```

No enable-switch or live POST command is part of this runbook. Enabling is a separate human operational approval after acceptance.

## Review evidence

- Shared staging: 17/17 focused tests, including UK, latest account, absent/mismatched shop, disconnected account, status/tracking conflict, explicit catalog rejection, no provider alias inference and transaction error propagation.
- Sheets reconcile: terminal intent readback is checked again against the exact B-column Cotik OrderID for CONFIRMED, FAILED and ABORTED intents. CONFIRMED writes only after READBACK=OK; terminal failures write READBACK=NOT_CONFIRMED or READBACK=CONFLICT evidence, never a success claim. PENDING/IN_PROGRESS, missing intents and unavailable account tokens remain blank for later review/retry. The CLI tracking suite passed 16/16 tests, including the reconcile cases; the Sheets adapter suite passed 10/10.
- Scheduler entrypoint: 4/4 focused tests for missing deployment, pacing, non-overlap, retry after failure and production invocation.
- Discovery/reset integration: 8/8 focused tests, including invalidating stale mapping on incomplete discovery and rejecting blank deployment identity.
- Historical intermediate run: 143 files passed, 1 failed, 19 skipped; 1,210 tests passed, 1 failed, 74 skipped. The failure was an endpoint-observation timeout in an unchanged Finance browser test; it is not used as final evidence.
- Drizzle check: passed offline. This does not execute migrations or establish that any W21 migration is installed.
- Final full suite after the reconcile terminal-evidence repair, 2026-09-07: `pnpm test` EXIT 0; 146 files passed, 19 files skipped; 1,264 tests passed, 74 skipped. The CLI tracking suite passed 16/16 and the Sheets adapter suite passed 10/10 before the full-suite rerun.
- `pnpm typecheck`: EXIT 0, all workspace packages including Dashboard route generation.
- `pnpm build`: EXIT 0, all workspace packages; Dashboard route table contains both `/api/cotik/kill-switch` and `/api/cotik/tracking`.
- `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts`: EXIT 0. W21 SQL/schema tests are offline; actual PostgreSQL execution and concurrency/migration application are not proven by mocked tests or the snapshot check.
- Legacy `shop-health doctor` was used during the historical acceptance run and is no longer part of the CLI because the AdsPower health-check flow was removed. Supabase-backed status and idempotent migration checks passed; both switches remain OFF.
- `pnpm shop-health cotik-tracking kill-switch status --json`: EXIT 0; Supabase-backed singleton reports both switches OFF and no deploy version.
- Read-only Cotik smoke checks: five configured token lanes returned HTTP 200 / body status 200 for `GET /order/list?page=1&sizeperpage=1`; totals were recorded without order payloads or PII. Provider catalog provisioning added 7 active explicit entries (4 US, 3 UK) to the new Supabase target. Controlled manual auto-tracking POST and readback verification were completed separately.
- Read-only Sheets verification, 2026-09-07: exact spreadsheet/tab metadata resolved to `CO Ebay & Shein Nội Bộ` / `Tháng 9-US`; date serials mapped to `2026-09-04` for 47 rows (sheet rows 159-205). Of those, 20 rows had blank W and complete B/Z/AC inputs, 20 already had W text, and 7 lacked AC; no rows lacked B or Z. No Sheets write was sent.
- Scoped `git diff --check`: passed after removing trailing blank lines in shared DB files. Existing unrelated WIP was not reformatted.

## Cross-review disposition

| Slice | Independent review and disposition |
| --- | --- |
| Staging / scheduler / writer | Beauvoir initially requested changes, then approved after dual-switch reservation, current GET readiness, full identity-conflict rejection and safe recovery repairs. |
| Dashboard | Mill found no actionable high-severity issue; confirmed mounted UI, safe routes, explicit enabling confirmation, OFF staging and accurate worker warning. |
| CLI / Sheets | Herschel verified exact tab/header/precision/bounds and fixed bounded timeout; root integrated and verified with full tests. |
| Persistence | Volta found active encryption key/version plumbing and pre-projection lastSeenAt gaps. Volta repaired vault inputs; root repaired timestamp order and independently checked symmetric keyring selection, preserving old metadata and fail-closed unknown keys. Focused regressions and full gates pass. |
| Writer / fingerprint re-review | McClintock found delimiter ambiguity in legacy fingerprint construction. Root retained historical hashes to avoid replay, added full tuple equality rejection on both candidate/intent conflicts and a failing-then-passing regression. McClintock final verdict APPROVE. |

## Nine blocker disposition

| Blocker | Code-level closure | Remaining operational evidence |
| --- | --- | --- |
| Candidate/intent pipeline | Shared transactional staging called by CLI, read-only Sheets and GUI. | Operator-selected actual source rows and installed schema. |
| POST attempt cap | No hidden POST retry, atomic durable reservation, max 3, readback-only uncertain recovery. | Real PostgreSQL concurrency/crash exercise and controlled live readback. |
| UK region | Explicit input, validated shop region, persisted intent, grouped worker and DB constraint without US default. | Live UK account/order fixture. |
| GUI | Mounted settings and shop form; tracking and kill-switch routes present. | Authorized runtime interaction against migrated DB. |
| Atomic onboarding | Account and encrypted token persist in one transaction. | Real DB vault failure/rollback exercise. |
| Migration singleton/journal | Corrected W21 chain plus journaled 0046; consolidate OFF before singleton index and fail closed on unsafe legacy region/budget. | Inspect installed journal, backup and approved upgrade trial. |
| Shop identity | Invalid numeric prefix returns insufficient, never SHOP_id; stale discovery links invalidated. | Live notes reconciliation. |
| Account winner | lastSeenAt then account ID; refreshed before projection, item provenance, persisted safe unattempted reroute. | Live multi-account overlap sample. |
| Pacing/vault version | Actual token request pacing 2/sec and 60/min; write/read key-version symmetry with active key selection. | Deployment secret/keyring rollout and multi-process pacing assessment. |

Rate pacing is process-local; the worker uses the global cycle lock, but separate CLI/GET processes do not share token clocks. Do not claim a distributed per-token limiter.

## Live acceptance

Manual auto-tracking POST, readback and kill-switch behavior were verified by the operator. Scheduled execution and historical replay remain separate follow-up scope.

## Git packaging

Baseline is branch `codex/v1-boss-dashboard-merge`, HEAD `c8b269a`; the dirty/untracked tree contains unrelated Dashboard work and pre-existing W21 sources. No history rewrite or blanket staging is safe. A branch count is not proof that work is merged. The current pass stages only an explicit W21/Supabase file manifest; unrelated UI, screenshots, harness caches, `.env`, OAuth files and scratch data remain outside the package.

Suggested dependency order for a later explicitly authorized packaging pass:

1. DB/domain W21 foundations, migrations and metadata, vault/provider/shop/order/attempt contracts and tests. Include every required new source and schema export, not just this turn diff.
2. Cotik transport/discovery/readback and tests, plus sync staging/Sheets/discovery integration.
3. Worker scheduler/cycle and CLI onboarding/staging, with matching tests and workspace dependencies.
4. Dashboard Cotik routes/settings/form only; select shared settings-page hunks without unrelated visual WIP.
5. Acceptance ledger, runbook and plan with exact validation results.

Before each commit inspect staged diff and secret scan; do not include ignored Cotik API guide, OAuth directories, .env, scratch, screenshots, unrelated UI changes, build artifacts or agent caches. Re-run final gates on the resulting clean checkout. No commit hashes are invented for the uncommitted implementation.
