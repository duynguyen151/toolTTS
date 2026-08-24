# Tool_TTS V1 Execution Ledger

## Authority and handling

- `docs/plans/2026-08-25-tool-tts-v1-master-plan.md` is the locked repository-local implementation authority. It owns V1 scope, task contracts, dependency DAG, acceptance gates, and Definition of Done.
- `docs/integrations/cotik/public-api-guide.md` is a local API reference supplied by COTIK, the ERP service in use. It may contain credentials and is intentionally Git-ignored: agents may read it locally when required, but it must not be staged, committed, printed into evidence, or pushed.
- Current source, tests, and runtime evidence establish implementation reality. They do not reopen locked product semantics.

## Locked execution invariants

- Official Finance On Hold is distinct from Operational Exposure; the latter is supporting context only.
- COTIK statements/payments are `SUPPLEMENTARY_FINANCE` only and cannot satisfy Official On Hold.
- Business time is GMT+07 (`Asia/Bangkok`); proxy, browser, seller, server, and exit-IP timezones do not redefine it.
- BA decisions are `SCALE`, `CONTINUE`, `SLOW_SELL`, `WATCH`, and `PAUSE`.
- Requested AI configuration resolves before construction; the immutable Decision Case persists before AI invocation.
- AI advises; BA decides; neither AI nor BA mutates a Case.
- V1 performs no Seller Center or COTIK business write action.

## Exclusive ownership zones

Only one implementation worker may edit each shared integration seam at a time:

- `packages/domain` shared contracts;
- `packages/db/src/schema.ts`;
- Drizzle migrations and journal;
- shared Decision Case contracts;
- shared provider contracts;
- any additional integration seam identified by task investigation.

## Superseded documentation references (do not edit in W0-T01)

- `README.md`, **Risk Rule V1** (lines 70-114): describes operational Onhold/Holiday Mode terminology and is superseded for new V1 reviews by Official On Hold plus authoritative Delivery Rate.
- `README.md` lines 14 and 158: says V1 has no web UI / describes Dashboard as deferred; locked V1 includes minimal functional Dashboard work.
- `CURRENT_IMPLEMENTATION_STATUS.md`, **Master Roadmap** (lines 29-33) and **V1 CLI decision workflow / Current semantics** (lines 139-151): reflects the previous roadmap and four-decision BA model; `SLOW_SELL` and the locked V1 ordering supersede this for new work.
- `CURRENT_IMPLEMENTATION_STATUS.md` line 21: historical RAG wording is deferred under locked V1 scope.

## Git baseline captured before W0-T01

- Workspace: `C:\DUY - DoWorks\Tool_TTS-boss-merge`
- Branch: `codex/v1-boss-dashboard-merge`
- HEAD: `c2f14d41100fffcdd96a311bb4d69515d59f8c10`
- Baseline: 28 modified tracked entries and 25 untracked entries observed before W0-T01.
- Ruling: pre-existing WIP is preserved; no reset, clean, stash, switch, unrelated staging, or unrelated commit is permitted. Counts may change only when a bounded task adds its own artifact.

## Task ledger

| Task ID | State | Direct Dependencies | Scheduled/Unscheduled | Worker | Reviewer | Owned Files/Modules | Tests | Review Verdict | Verification | Accepted Commit/Checkpoint | Blocker | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W0-T01 | DONE | None | Completed | Technical Director recovery after three no-output worker attempts | Independent read-only reviewer | `docs/plans/2026-08-25-tool-tts-v1-master-plan.md`; this ledger; `.gitignore` | Documentation consistency; Git inventory; placeholder scan; `git diff --check` | APPROVE | PASS: scoped diff check; ignored-guide verification; independent review | `17fa6002797590741a123b0481410cb515454a3f` | None | Accepted 2026-08-25. Documentation-only authority/ownership gate; local COTIK guide is intentionally ignored and excluded from commit. |
| W0-T02 | DONE | W0-T01 | Completed (bootstrap priority) | Technical Director recovery after stalled worker | Independent Finance reviewer | `packages/db/src/queries/finance.integration.test.ts`; `docs/execution/w0-t02-finance-population-decision.md` | Focused Finance characterization; skipped disposable-DB diagnostic | APPROVE | PASS: 3 files/20 tests; 4 DB tests skipped because `TEST_DATABASE_URL` is unset | `ebebcb53c775178fe5189435ffc9e7fe42b29cd8` | ENVIRONMENT_PENDING: disposable PostgreSQL | Accepted 2026-08-25. Cross-capture mutable-row contamination; W5 must preserve immutable capture values/versioning or report proof unavailable. |
| W11-T01 | DONE | W0-T01 | Completed | Bounded worker plus Director repair | Independent interface reviewer | `packages/domain/src/contracts/source.ts`; `orders.ts`; `source.test.ts` | 8 focused contract tests; strict standalone test typecheck; domain typecheck | APPROVE | PASS: focused Vitest; strict test `tsc`; domain typecheck; scoped diff check | `13b8dfcf55d897064ff0bd993e78d756082293c5`, `373a6a211dcaf8006444593a92320a2e500a29d1` | None | Accepted 2026-08-25. `ReadProviderDataSource` permits COTIK Orders/supplementary Finance; SellerDataSource retains Official-OH requirement. |
| W11-T02 | DONE | W11-T01 | Completed | Foreground bounded DB worker plus Director integrity repair | Independent PostgreSQL/security reviewer | `shop_provider_bindings` schema/migrations; provider binding repository/tests | 8 unit tests; 5 DB integration tests skipped; Drizzle check; DB typecheck | APPROVE | PASS: unit/Drizzle/typecheck/diff checks; DB integration migration run pending | `c84df5f6517010c97d2214b6daf32267ba65af6d`, `cfc993363a343f5fb3e71433d91a865f44523216` | ENVIRONMENT_PENDING: disposable PostgreSQL | Accepted 2026-08-25. Provider/provenance equality is enforced at app and SQL boundaries; no speculative legacy backfill; unexported module is deliberate because db index carries unrelated WIP. |
| W1-T01 | DONE | W11-T01 | Completed | Director recovery after stalled worker | Independent security/API reviewer | `packages/cotik` read client, tests, workspace manifest/lockfile | 10 focused client tests; package typecheck/build | APPROVE | PASS: focused tests, typecheck, build, diff checks | `9e5c608e1781a20aac768f37337187a4a12c0365` | None | Accepted 2026-08-25. Read-only GET client validates HTTP plus body semantics; token-wide lanes serialize cross-client requests; no tokens in URL/errors. Minor: Retry-After is intentionally honored as returned. |
| W1-T02 | READY | W1-T01, W11-T02 | Scheduled | Pending bounded worker | Pending provider/integration reviewer | Explicit COTIK shop discovery and binding CLI | CLI tests and persisted binding readback | — | — | — | ENVIRONMENT_PENDING: disposable PostgreSQL | Must not infer canonical identity from display names. |

## Scheduling rule

A dependency unlocks only after its task is accepted/done. READY does not mean scheduled. Bootstrap remains sequential: W0-T01, then W0-T02.
