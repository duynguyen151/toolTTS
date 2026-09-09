# Tool_TTS - Historical Implementation Evidence

> This file records the pre-Master-Plan integration milestone on
> `codex/v1-integration`; it is not current operational state and must not be
> updated as a task tracker. For current scope, acceptance, continuation, and
> implementation truth, use `AGENTS.md`, the locked Master Plan, the execution
> ledger, the Codex handoff, and current Git state respectively.
>
> The historical claims below remain useful evidence only where their exact
> commits, environment, and verification commands can be established. The
> locked V1 semantics supersede this file's earlier four-decision model,
> Operational-Onhold Rule terminology, and Dashboard-deferred wording.

## Repository

```text
C:\DUY - DoWorks\Tool_TTS-integration
```

- Git branch: `codex/v1-integration`
- Frozen AI commit: `3fa4b58 feat: complete V1 baseline AI runtime`
- Frozen Dashboard commit: `72faddc feat: complete dashboard AdsPower update workflow`
- Integration merge commits: `973aa13` (AI), `33514f3` (Dashboard)
- Stable Seller Center extraction commit: `49cad57 feat: lock down live seller data coverage`
- No push or merge to master was performed for this wave.

## Verified LIVE extraction milestone

Profile `957` reached:

```text
OVERALL LIVE DATA = PASS
```

### Orders

- Source rows: `9`
- Unique order IDs: `9`
- Persisted rows: `9`
- Pagination: `COMPLETE`
- Proven source history window: rolling 12 months
- `lifetimeHistoryComplete=false`
- Status coverage: complete; unknown statuses: `0`
- Shipping coverage: complete
- Reverse/refund state: captured
- Refund amount: `NOT_AVAILABLE_FROM_SOURCE` and therefore remains `null`

Verified status mapping/counts:

```text
101/1   -> AWAITING_SHIPMENT: 2
101/2   -> AWAITING_SHIPMENT: 3
102/310 -> DELIVERED: 3
104/0   -> CANCELED: 1
UNKNOWN: 0
```

### Finance

- Required V1 Finance scope: complete
- Official Finance On Hold: `$277.80`
- Waiting for package delivery: `$145.38`
- Delivered awaiting settlement: `$132.42`
- Completed refund/return adjustment: `$0.00`
- Reconciliation: `$145.38 + $132.42 + $0.00 = $277.80` (`PASS`)
- On Hold detail: `8/8`
- Finance to Orders linkage: `8/8`
- Payouts source total: `0`
- Statements: `OPTIONAL`, deferred
- Invoices and Earnings Analytics: `OPTIONAL` for current V1

Repeat sync is idempotent and does not create duplicate orders or Finance rows.
The production-code and persisted-data PII/security scans returned `0` findings.
Independent reviewer verdict: `APPROVE`.

### Completeness semantics

- `COMPLETE` means complete within the proven V1 source window. It never means
  complete lifetime Seller Center history.
- `FULL_PERSISTED_HISTORY` must not be represented as `FULL_SELLER_CENTER_HISTORY`.
- Official Finance On Hold is the Seller Center Finance value. Operational or
  order-derived exposure is a separate metric and must not replace or be merged
  with the official value.
- Fields unavailable from an authoritative source remain explicitly unavailable
  or `null`; they must never be fabricated, estimated, or converted to zero.
- Seller Center extraction at commit `49cad57` is a stable subsystem. Dashboard,
  AI, and BA waves must consume its boundaries and must not refactor extraction
  unless a concrete integration failure demonstrates that a change is required.

## Current architecture

```text
AdsPower / Seller Center (live sync only)
    -> normalization
    -> PostgreSQL / Drizzle
    -> deterministic metrics and Rule Result

Persisted PostgreSQL or sanitized DEMO seed
    -> immutable Decision Case
    -> optional baseline AI recommendation
    -> BA decision
    -> confirmed Holiday Mode DRY_RUN
    -> keyset-paginated decision history
    -> stable CLI presentation contracts
```

The deterministic domain layer does not depend on the AI provider, database,
browser, or presentation. Rule, AI, BA, and Execution are persisted and shown
as separate records.

## Apps and packages

```text
apps/cli
apps/dashboard
apps/worker

packages/domain
packages/db
packages/decision-ai
packages/decision-workflow
packages/seller-center
packages/sync
```

## V1 CLI decision workflow

Implemented commands:

```text
shop-health review start <profileNo> [--request-id <uuid>] [--json]
shop-health review show <caseId> [--json]
shop-health review decide <caseId> --decision <...> --reason-code <...> [--json]
shop-health review execute <caseId> --confirm [--request-id <uuid>] [--json]
shop-health review history <profileNo> [--limit <1..100>] [--cursor <opaque>] [--json]
```

Stable presentation schemas:

```text
decision-review.v1
decision-history.v1
```

Current semantics:

- Only `review start` creates a Decision Case.
- Decision Case snapshots are immutable; a BA revision requires a new case.
- A case has at most one baseline AI result, one BA decision, and one execution.
- AI is `AVAILABLE` or `UNAVAILABLE`; failures never fabricate a recommendation.
- AI provenance stores provider, requested/reported/actual model, auth mode,
  output schema version, prompt version, and rule/AI policy versions.
- AI input contains normalized metrics, deterministic Rule Result, thresholds,
  and fixed R1-R5 risk context; it excludes shop identity, raw orders, PII,
  cookies, tokens, and browser/session data.
- BA can decide `SCALE`, `CONTINUE`, `WATCH`, or `PAUSE` even when AI is unavailable.
- Only confirmed BA `PAUSE` can create `HOLIDAY_MODE_ON` as `DRY_RUN` / `SIMULATED`.
- Every execution records `sellerCenterCalled=false`.
- History keeps Rule, AI, BA, and Execution separate and uses keyset pagination.

## Data origin

- Shops and Decision Cases carry `LIVE` or `DEMO_SANITIZED` origin.
- Existing shops migrated as `LIVE`.
- Sanitized DEMO shops are disabled and have no source sync run.
- `pnpm db:seed:demo` is deterministic and idempotent.
- `DEMO-001` is available locally for the CLI workflow.
- DEMO history is not returned by LIVE history queries.

## PostgreSQL runtime

- PostgreSQL 16 service: `postgresql-x64-16`
- Port: `5432`
- Development database: `shop_health_dev`
- Test database: `shop_health_test`
- Credentials and URLs are stored only in ignored `.env`.

The database runtime was detected before installation. No duplicate service or
container was created.

## Baseline AI

Provider configuration:

```text
TOOL_AI_PROVIDER=9router
TOOL_AI_BASE_URL=http://127.0.0.1:20128/v1
TOOL_AI_FREE_ONLY=true
TOOL_AI_DEFAULT_MODEL=oc/deepseek-v4-flash-free
TOOL_AI_ALLOWED_MODELS=oc/deepseek-v4-flash-free,oc/big-pickle,oc/hy3-free,oc/laguna-s-2.1-free,oc/nemotron-3-ultra-free,oc/nemotron-3.5-lightning-free
TOOL_AI_FALLBACK_MODELS=
```

The client uses native `fetch` and strict Zod structured-output validation.
Disabled configuration, missing key, timeout, network/HTTP/rate-limit failure,
malformed response, or invalid output persists `AI UNAVAILABLE` with a sanitized
failure code. Loopback 9Router allows no application key; non-loopback endpoints
require `TOOL_AI_API_KEY`.

## Seller Center boundary

- AdsPower profile `957` was used for verified LIVE Seller Center extraction.
- Orders and required Finance data are collected from proven structured Seller
  Center sources, normalized, and persisted through the existing package seams.
- No replacement scraper, login flow, or alternate live data source was added.
- No Seller Center request is made by the review/decision/execution path.
- Holiday Mode remains DRY_RUN only.

Secrets and browser internals are implementation-private. Public status, read
models, logs, documentation, and future UI contracts must not expose cookies,
session/browser storage, authorization data, API keys, CDP endpoints, or proxy
credentials.

## Stable application boundaries for Dashboard

Dashboard presentation reuses these existing application/package boundaries
rather than importing browser internals or rebuilding business logic:

| Capability | Stable boundary |
| --- | --- |
| AdsPower profile status/open | `AdsPowerClient.active`, `AdsPowerClient.open`, and `SellerDataSource.health`; expose only sanitized availability/status results |
| LIVE sync/update data | `runShopSync` and `SyncResult`; CLI JSON contract `sync-result.v1` |
| Orders read model | `listOrders`; CLI JSON contract `order-list.v1` |
| Finance/On Hold read model | `getFinanceSummary`, `listOnHoldSettlements`; CLI JSON contracts `finance-summary.v1` and `finance-on-hold.v1` |
| Sync result/failure state | `listSyncRuns`, `ShopSyncState`, and CLI JSON contracts `sync-history.v1` / `shop-status.v1` |
| Coverage state | `SyncResult.sourceCoverage`: `SELLER_CENTER`, `ROLLING_12_MONTHS`, `completeWithinWindow`, and `lifetimeHistoryComplete=false` |

The UI adapts these application results into presentation DTOs, but it does not
receive or expose `AdsPowerBrowserConnection.cdpEndpoint` or other secret
connection material.

## Dashboard Checkpoint A

The local Next.js Dashboard presentation is implemented in `apps/dashboard`.
Its `UPDATE DATA` operation stays behind the server/application boundary and
reuses the existing AdsPower, Seller Center, and sync subsystems.

Locked behavior:

- Probe the AdsPower Local API and, when necessary, launch AdsPower through the
  application-level service with a bounded readiness timeout.
- Resolve the exact selected profile; open it only when closed, otherwise reuse
  the existing session; wait for browser/CDP readiness before collection.
- Verify the Seller Center session before running the existing LIVE Orders,
  Finance, reconciliation, persistence, and deterministic risk workflow.
- Return `HUMAN_ACTION_REQUIRED` with an `OPEN PROFILE` action for login or
  security challenges. The Dashboard does not bypass human authentication.
- Preserve required source-coverage and source/fetched/persisted reconciliation
  gates. Incomplete required data returns `PARTIAL` or `ERROR`, never `SUCCESS`.
- Keep DEMO operations disabled and preserve `NOT_VERIFIED`; missing values are
  not fabricated or silently converted into complete results.

The local operation routes validate loopback host/origin, forwarded headers,
and profile input. Cookies, tokens, credentials, proxy data, internal profile
identifiers, CDP endpoints, and raw upstream errors remain server-private.
Background CDP extraction may avoid foregrounding Seller Center tabs, but it
uses the same completeness guarantees as foreground extraction.

Desktop and mobile presentation verification artifacts:

```text
output/playwright/dashboard-checkpoint-a-verified-1440x900.png
output/playwright/dashboard-checkpoint-a-verified-mobile-390x844.png
```

The Dashboard uses the workspace-installed `playwright-core@1.62.1` browser
runtime. Its explicit `chromium-bidi@12.1.0` dependency is retained because
that Playwright version references the module without installing it.

## Deferred scope

The Dashboard does not add Redis, a queue, RAG, pgvector, Mastra, LangChain,
fine-tuning, or Seller Center write actions. Dashboard presentation consumes
stable decision and sync boundaries and does not reimplement deterministic
rules or workflow persistence.

## Known limitations and deferred items

- The proven Orders source window is rolling 12 months; lifetime history is not
  available or proven, so `lifetimeHistoryComplete` remains `false`.
- Refund/reverse state is captured, but refund amount is not available from the
  proven source and remains `null`.
- Payouts currently has an authoritative source total of zero.
- Statements, Invoices, and Earnings Analytics are optional/deferred for V1.
- `sync backfill` remains disabled with `BACKFILL_UNRESOLVED`; it must not claim
  lifetime Seller Center coverage.
- Holiday Mode live route/state/write remains outside this extraction milestone;
  all execution behavior remains DRY_RUN.

## V1 integration verification

Completed on 2026-08-15 with the ignored local `.env` loaded privately. Database
connection strings and credentials were not printed or committed.

```text
Development and test migrations 0014-0017: PASS
PostgreSQL-backed integration tests: PASS (9/9, no DB skips)
Full test suite: PASS (367/367)
pnpm typecheck: PASS
pnpm build: PASS
pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts: PASS
git diff --check: PASS
Legacy `shop-health doctor --json` diagnostic was previously green; the AdsPower health-check command was removed during the 2026-09-09 packaging handoff.
desktop/mobile visual verification: PASS
accessibility/keyboard verification: PASS
reviewer-luna final independent review: APPROVE (no findings)
```

Sanitized profile `957` live E2E passed through the real Dashboard
`/api/update-data` application path:

```text
AdsPower ready -> existing authenticated profile reused
Orders sync -> complete rolling 12-month source window -> persisted
Finance sync -> complete and reconciled -> persisted
Deterministic Rule -> Decision Case -> 9Router AI -> persisted AI Decision
Dashboard terminal state -> SUCCESS
Fresh CLI process and restarted Next process -> identical persisted Rule/AI data
```

Persisted coverage is `COMPLETE` only within `ROLLING_12_MONTHS`;
`lifetimeHistoryComplete=false`. The live AI decision is `AVAILABLE` with:

```text
provider = 9router
requestedModel = oc/deepseek-v4-flash-free
reportedModel = deepseek-v4-flash-free
actualModelUsed = deepseek-v4-flash-free
authMode = LOCAL_NO_AUTH
```

Official Finance On Hold remains separate from operational order-derived
exposure. No LIVE-to-DEMO fallback, paid/cx/auto-router fallback, completeness
gate weakening, CAPTCHA bypass, or Seller Center write action was introduced.
