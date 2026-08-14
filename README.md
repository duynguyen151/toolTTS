# TikTok Shop Health V1

Backend-first collector, deterministic shop-risk engine, and auditable decision CLI:

```text
Persisted PostgreSQL / sanitized DEMO seed
  -> KPI / deterministic Rule
  -> optional baseline AI recommendation
  -> BA decision
  -> Holiday Mode DRY_RUN
  -> decision history
```

V1 has no HTTP API, web UI, Redis, queue, or automatic Seller Center actions. Baseline AI is optional, fail-closed, and separate from the deterministic domain rule.

## Requirements

- Node.js 22+
- pnpm 11+
- PostgreSQL 16+
- AdsPower running locally with a dedicated, already authenticated profile only for live synchronization

## Setup

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:migrate
pnpm db:seed:demo
pnpm shop-health doctor
pnpm shop-health review start DEMO-001
```

`DATABASE_URL` is required for every command except `doctor`. `db:seed:demo` is deterministic and idempotent. It creates disabled `DEMO_SANITIZED` data only when a live source is unavailable; DEMO origin remains explicit in every Decision Case and history result.

The collector and decision workflow do not persist cookies, tokens, browser storage, buyer names, contact details, shipping addresses, or raw AI provider responses.

## Core Commands

```powershell
pnpm shop-health doctor
pnpm shop-health shop add --profile-no 957 --profile-id k1f2ocuk --region US --locale en-US
pnpm shop-health shop list
pnpm shop-health shop status 957
pnpm shop-health shop resume 957

pnpm shop-health sync orders 957
pnpm shop-health sync finance 957
pnpm shop-health sync history 957
pnpm shop-health sync request 957

pnpm shop-health orders list 957 --period 30d --limit 20
pnpm shop-health finance summary 957
pnpm shop-health finance on-hold 957
pnpm shop-health metrics show 957 --period 30d
pnpm shop-health report 957 --period 30d
pnpm shop-health risk evaluate 957

pnpm shop-health review start DEMO-001 --json
pnpm shop-health review show <case-id> --json
pnpm shop-health review decide <case-id> --decision WATCH --reason-code DATA_INCOMPLETE --json
pnpm shop-health review execute <case-id> --confirm --json
pnpm shop-health review history DEMO-001 --limit 20 --json

pnpm worker
```

Add `--json` to CLI commands for machine-readable output. Times are displayed in `Asia/Bangkok` by default and stored in PostgreSQL as UTC.

## Risk Rule V1

The risk rule uses an operational definition that is separate from Seller Center Finance On Hold.

- Operational Onhold Value: sum of order value for `AWAITING_SHIPMENT`, `IN_TRANSIT`, `DELIVERED`, and `COMPLETED`.
- Delivered Count: count of `IN_TRANSIT`, `DELIVERED`, and `COMPLETED`.
- Total Count: count of the same operational set used by Operational Onhold Value.
- Delivery Rate: `Delivered Count / Total Count`.
- Desired state is Holiday Mode ON when Operational Onhold Value is at least USD 3,500 OR Delivery Rate is below 70%.

Risk evaluation currently uses `FULL_PERSISTED_HISTORY`: every eligible order's
latest state currently stored in PostgreSQL, without an intentional date cutoff.
This is not a claim that the database contains the shop's lifetime history.
Coverage is reported as `UNKNOWN` until pagination/backfill completeness can be
proven. The CLI also shows the last successful order sync and the latest order
observation available in the persisted facts.

Operational Onhold Rate is deliberately shown as unavailable. Under the locked
BA definitions, Operational Onhold Count and Total Count use the identical
status set, so their ratio would always be 100% and would not be informative.
The actionable rate rule remains Delivery Rate below 70%.

The literal BA defaults are currently minimum sample `0`, resume rate `70%`, resume value below USD 3,500, and one safe cycle. These fields are configurable in the versioned domain policy because minimum sample and hysteresis have not been approved yet.

Holiday Mode execution is intentionally `DRY_RUN`. Rule, AI, BA, and Execution
are persisted and displayed as separate records. Only a confirmed BA `PAUSE`
decision can create a simulated `HOLIDAY_MODE_ON` execution, and every execution
records `sellerCenterCalled=false`. The system does not enable or disable
Holiday Mode until all of these are confirmed:

- Seller Center Holiday Mode route, state, and write request.
- The difference between automation-owned and manually enabled Holiday Mode.
- Minimum order sample for the rate rule.
- Resume buffer and number of stable cycles.
- Notification and audit expectations.

Unknown statuses, currency mismatch, empty operational data, or an unmet configured sample return `INSUFFICIENT_DATA`; they never silently produce a safe decision. A definitive stop condition still wins through the approved OR rule.

When unknown statuses exist, status-based counts and Delivery Rate are shown as
unavailable because those rows may belong to an operational status set. A rate
warning is never inferred from that incomplete population. When operational
currencies differ from the policy currency, Operational Onhold Value is also
unavailable; the known USD subtotal is disclosed separately and can still prove
a value warning when that subtotal alone reaches the threshold. An unobserved
Holiday Mode state remains `UNKNOWN`, not `false`.

## Current Live Coverage

Confirmed on AdsPower profile `957` / `k1f2ocuk`, US English Seller Center:

- AdsPower Local API and Playwright CDP attach.
- Order list and order-count response capture.
- Order status code `101` mapped to `AWAITING_SHIPMENT`.
- Finance summary snapshot capture through visible Seller Center navigation.

Implemented and validated by typechecks/tests/schema checks:

- Idempotent PostgreSQL order/snapshot persistence and concurrency locks.
- KPI, score, recommendation, operational risk evaluation, and CLI output.
- Immutable Decision Cases with separate AI, BA, and DRY_RUN execution records.
- Keyset-paginated decision history with explicit `LIVE` / `DEMO_SANITIZED` origin.
- Optional OpenCode Zen baseline AI with structured output and fail-closed `AI UNAVAILABLE` behavior.

Still unresolved and deliberately not guessed:

- Status mappings other than code `101`.
- Refund and settlement-row mappings.
- Carrier variants.
- Pagination/export request mapping and full history backfill.
- Holiday Mode route/state/action.
- Complete historical coverage. The current evaluator uses every persisted order's latest state, but pagination/backfill is unresolved and `COMPLETED` is intentionally included.

`sync backfill` is therefore disabled with `BACKFILL_UNRESOLVED`. Order sync also refuses to persist a response that indicates more pages until pagination is implemented, preventing partial data from being presented as complete.

PostgreSQL 16 is configured locally for `shop_health_dev` and `shop_health_test`. Migrations, sanitized DEMO seed, and the CLI decision flow have been exercised against PostgreSQL. Live Seller Center validation was not run in this decision-workflow wave; the review path does not require or call AdsPower.

## Development Checks

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts
pnpm db:migrate
pnpm db:seed:demo
pnpm shop-health doctor --json
```

PostgreSQL is the source of truth for CLI reports and Decision Cases. Seller Center extraction, normalization, persistence, deterministic rules, baseline AI, workflow orchestration, and CLI presentation remain separate modules. The deferred Dashboard Presentation Wave can consume `decision-review.v1` and `decision-history.v1` without moving business logic into the UI.
