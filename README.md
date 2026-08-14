# TikTok Shop Health V1

Backend-first collector and deterministic shop-risk CLI:

```text
AdsPower -> TikTok Seller Center -> PostgreSQL -> KPI / Risk Rules -> CLI
```

V1 has no HTTP API, web UI, Redis, BullMQ, Socket.IO, LLM, or automatic Seller Center actions.

## Requirements

- Node.js 22+
- pnpm 11+
- PostgreSQL 16+
- AdsPower running locally with a dedicated, already authenticated profile

## Setup

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:migrate
pnpm shop-health doctor
pnpm shop-health shop add --profile-no 957 --profile-id k1f2ocuk --region US --locale en-US
```

`DATABASE_URL` is required for every command except `doctor`. The collector does not persist cookies, tokens, browser storage, buyer names, contact details, or shipping addresses.

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

Holiday Mode execution is intentionally `DRY_RUN`. The CLI separates the
internal desired state from the BA-facing rule result and always reports
`Executed Action: NONE`. A warning suggests `REVIEW_SHOP`; it does not claim the
shop was stopped. The system does not enable or disable Holiday Mode until all
of these are confirmed:

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

Still unresolved and deliberately not guessed:

- Status mappings other than code `101`.
- Refund and settlement-row mappings.
- Carrier variants.
- Pagination/export request mapping and full history backfill.
- Holiday Mode route/state/action.
- Complete historical coverage. The current evaluator uses every persisted order's latest state, but pagination/backfill is unresolved and `COMPLETED` is intentionally included.

`sync backfill` is therefore disabled with `BACKFILL_UNRESOLVED`. Order sync also refuses to persist a response that indicates more pages until pagination is implemented, preventing partial data from being presented as complete.

The current machine has no configured `DATABASE_URL`, so migrations and end-to-end PostgreSQL persistence have not yet been exercised against a live database.

## Development Checks

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts
pnpm shop-health doctor --json
```

PostgreSQL is the source of truth for CLI reports. Seller Center extraction, normalization, persistence, metrics, recommendations, and CLI presentation remain separate modules so a future TikTok Open API data source does not require rewriting KPI or reporting logic.
