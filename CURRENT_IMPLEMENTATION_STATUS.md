# Tool_TTS - Current Implementation Status

> Update this file whenever the implementation materially changes.
> This is operational state, not long-term product strategy.

## Repository

```text
C:\DUY - DoWorks\Tool_TTS
```

- Git branch: `master`
- Baseline commit: `273573b baseline: V1 decision capture foundation`
- Stable Seller Center extraction commit: `49cad57 feat: lock down live seller data coverage`
- No Git remote or push is configured for this wave.

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
- Official Finance On Hold: `$310.16`
- Waiting for package delivery: `$177.33`
- Delivered awaiting settlement: `$132.83`
- Reconciliation: `$177.33 + $132.83 = $310.16` (`PASS`)
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
- AI provenance stores provider, model, prompt version, and policy version.
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
TOOL_AI_PROVIDER=opencode-zen
TOOL_AI_BASE_URL=https://opencode.ai/zen/v1
TOOL_AI_MODEL=deepseek-v4-flash-free
```

The client uses native `fetch` and strict Zod structured-output validation.
Disabled configuration, missing key, timeout, network/HTTP/rate-limit failure,
malformed response, or invalid output persists `AI UNAVAILABLE` with a sanitized
failure code. No live provider smoke test is required without an API key.

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

## Stable application boundaries for future UI

Future Dashboard presentation should reuse these existing application/package
boundaries rather than importing browser internals or rebuilding business logic:

| Capability | Stable boundary |
| --- | --- |
| AdsPower profile status/open | `AdsPowerClient.active`, `AdsPowerClient.open`, and `SellerDataSource.health`; expose only sanitized availability/status results |
| LIVE sync/update data | `runShopSync` and `SyncResult`; CLI JSON contract `sync-result.v1` |
| Orders read model | `listOrders`; CLI JSON contract `order-list.v1` |
| Finance/On Hold read model | `getFinanceSummary`, `listOnHoldSettlements`; CLI JSON contracts `finance-summary.v1` and `finance-on-hold.v1` |
| Sync result/failure state | `listSyncRuns`, `ShopSyncState`, and CLI JSON contracts `sync-history.v1` / `shop-status.v1` |
| Coverage state | `SyncResult.sourceCoverage`: `SELLER_CENTER`, `ROLLING_12_MONTHS`, `completeWithinWindow`, and `lifetimeHistoryComplete=false` |

The UI may adapt these application results into presentation DTOs, but it must
not receive or expose `AdsPowerBrowserConnection.cdpEndpoint` or other secret
connection material.

## Deferred scope

The Dashboard Presentation Wave remains deferred until a UI reference is
provided. This wave does not add Next.js, Tailwind, shadcn, TanStack Table,
Poppins, Heroicons, Recharts, an HTTP API, Redis, a queue, RAG, pgvector,
Mastra, LangChain, or fine-tuning.

Future dashboard code should consume the stable decision presentation schemas
and must not reimplement deterministic rules or workflow persistence.

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

## Verification

Final extraction verification on 2026-08-14:

```text
pnpm typecheck: PASS
pnpm test: PASS (204/204)
pnpm build: PASS
pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts: PASS
```

Exact verification commands:

```powershell
pnpm typecheck
node --env-file=.env node_modules/vitest/vitest.mjs run
pnpm build
pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts
```

The explicit Node test command loads ignored local test-database configuration
so the PostgreSQL integration tests run instead of being skipped.

Independent built-CLI PostgreSQL E2E passed:

```text
same request ID -> same immutable case
origin -> DEMO_SANITIZED
AI -> UNAVAILABLE / MISSING_API_KEY
BA -> PAUSE persisted
Execution -> HOLIDAY_MODE_ON / DRY_RUN / SIMULATED
sellerCenterCalled -> false
History -> decision-history.v1 with Rule / AI / BA / Execution separate
```

Reviewer verdict: `APPROVE`.
