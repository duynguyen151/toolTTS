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
| W1-T02 | DONE | W1-T01, W11-T02 | Completed | Foreground bounded worker plus Director contract repair | Independent provider/integration reviewer | COTIK discovery/bind/unbind CLI; provider binding disable repository | 14 CLI tests; 8 binding unit tests; 6 DB tests skipped; CLI typecheck/build | APPROVE | PASS: 22 focused tests; CLI/DB/COTIK typechecks; CLI build; sanitized discovery contract re-review | `7dfbaa2e8db28a1c19bb1deb6d61e42ac5696397`, `8de8929c959d8ddf9e12449ca08a787dc338ea22` | ENVIRONMENT_PENDING: disposable PostgreSQL | Accepted 2026-08-25. Explicit `_id` only; documented Statements `data.list_shop` discovery uses page=1/sizeperpage=50; no name matching or COTIK writes. |
| W2-T01 | DONE | W1-T01, W11-T01 | Completed | Foreground bounded enum/migration worker | Independent domain/privacy reviewer | Canonical status contract, COTIK order normalizer, enum migration | 55 focused tests; Drizzle check; domain/COTIK/DB/Seller Center typechecks | APPROVE | PASS: focused normalizer/domain/Seller Center tests; Drizzle/typechecks/diff check | `6432f21` | ENVIRONMENT_PENDING: disposable PostgreSQL migration application | Accepted 2026-08-25. COTIK order normalizer is allowlisted and internal pending W2-T02 adapter integration; no Seller Center mapping changes. Minor follow-up: export only if cross-package consumer requires it. |
| W2-T02 | DONE | W1-T02, W2-T01, W11-T02 | Completed | Foreground bounded seam worker plus integration repair | Independent integration/privacy reviewer | COTIK pagination/ingestion, binding checkpoint repository, COTIK orders sync route | 75 focused tests; 7 DB integration tests skipped; DB/COTIK/sync typechecks/builds; Drizzle check | APPROVE | PASS: COTIK pagination + binding-driven sync tests; DB/COTIK/sync checks; checkpoint race red/green re-review | `b1068b46584fc8642bf1dd9519dd750ef8c476ce`, `b2b82c010d55a73622d3be8cf20d01e9cbc8a38b`, `39202db29f2453013924cadd57e3653e188e99d9` | ENVIRONMENT_PENDING: disposable PostgreSQL | Accepted 2026-08-25. COTIK-specific route preserves Seller Center sync; checkpoint writes only after complete pages and fails closed if binding disappears. No lifetime completeness claim. |
| W3-T01 | DONE | W2-T01 | Completed | Two nonproductive bounded workers; Director takeover | Independent query/privacy reviewer plus scoped re-review | Bangkok analytical period resolver; Orders explorer DB read DTOs/queries/tests | 7 unit tests; 1 PostgreSQL query integration; DB/CLI typechecks; DB build | APPROVE | PASS: 7 focused unit tests; reviewer executed 5/5 focused tests including PostgreSQL integration; DB/CLI typechecks; DB build; scoped re-review | `3c70c64956868040ed1c67ef9e49a7ce727ff165`, `b53ba6337df6a555cee197d548ccea4ef0f6950b` | CLI build ENVIRONMENT_PENDING: missing `@esbuild/win32-x64` optional binary during existing postbuild | Accepted 2026-08-25. Asia/Bangkok filters are analytical only; list/detail are explicit allowlists; shared SQL predicates keep filtered list/distribution reconciled; All Available does not claim lifetime completeness. Model routing unavailable in tool result. |
| W12-T01 | DONE | W2-T01 | Completed | Two nonproductive bounded workers; Director takeover | Independent domain/business reviewer plus scoped re-review | Authoritative delivery-rate domain contract; Risk evaluator integration; analytical Bangkok period resolver | 40 focused domain tests; domain typecheck/build | APPROVE | PASS: focused delivery/risk/metrics tests; domain typecheck/build; review red/green; scoped re-review | `49b39a7fe1fa445771762aaa9de09cad886a1b70`, `a52444335bf4910fb0142291a6b5a8c09be0e6c4` | None | Accepted 2026-08-25. Rule derives delivered/total/rate only from the explicit full-population authoritative status sets; UNKNOWN fails closed. Analytics are separate, Bangkok-fixed, leap-safe, and publicly exported; no CLI/Dashboard wiring in this contract task. Model routing unavailable in tool result. |

## Scheduling rule

A dependency unlocks only after its task is accepted/done. READY does not mean scheduled. Bootstrap remains sequential: W0-T01, then W0-T02.
