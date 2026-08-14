# Tool_TTS — Current Implementation Status

> Update this file whenever the implementation materially changes.
> This is operational state, not long-term product strategy.

## Repository

Path used in previous Codex session:

```text
C:\DUY - DoWorks\Tool_TTS
```

Current architecture:

```text
AdsPower Local API
    ↓ CDP / Playwright
Seller Center collector
    ↓ normalize
Sync orchestration
    ↓ transactional locks/upsert
PostgreSQL / Drizzle ORM
    ↓
Domain metrics + recommendations + risk rules
    ↓
CLI reports / background worker

PostgreSQL decision capture foundation
    ↓
Immutable decision case + append-only BA decision
```

## Current apps/packages

```text
apps/cli
apps/worker

packages/seller-center
packages/sync
packages/db
packages/domain
```

## Confirmed implementation state

- V1 backend-first implementation exists.
- No HTTP API at last inspection.
- No web dashboard at last inspection.
- No Redis or queue at last inspection.
- No production LLM integration at last inspection.
- Market support: US / en-US.
- AdsPower live profile previously tested: `957`.
- Orders collection returned 2 live rows in that test.
- Finance snapshot worked.
- AdsPower profile remained Active.
- Holiday Mode is DRY_RUN.
- Orders and finance persistence are intended to be idempotent.
- Locking and sync-run audit exist.
- Previous fixes:
  - DB self-deadlock;
  - safe-cycle race;
  - stale writes;
  - audit masking source error.
- Current risk evaluation uses all latest persisted eligible order state.
- Historical coverage is not proven.
- `sync backfill` is blocked with `BACKFILL_UNRESOLVED`.
- Confirmed order status mapping:
  - `101 -> AWAITING_SHIPMENT`
- Other status mappings still require source verification.
- Decision capture foundation now exists:
  - privacy-safe, strict decision snapshot contracts;
  - explicit Rule Result to product decision mapping;
  - `decision_cases` immutable snapshot rows;
  - append-only `ba_decisions` rows;
  - atomic `captureBaDecision` transaction boundary;
  - same-shop provenance enforced between a decision case and its source sync run.
- Decision snapshot inputs do not accept raw Seller Center payloads, buyer/contact/address fields, cookies, tokens, or session data.
- AI decisions and execution records remain separate and are not implemented yet.
- No known cookie/token/session/buyer PII in normalized logs from the previous review.

## Latest reported validation

```text
pnpm typecheck: PASS
pnpm test: PASS (76 tests)
pnpm build: PASS
pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts: PASS
```

Live PostgreSQL E2E:
```text
NOT RUN — no working DATABASE_URL
```

Reason:
```text
DATABASE_URL is not configured in the current environment
```

Current runtime diagnostics:

```text
Node.js: OK (v22.20.0)
PostgreSQL: SKIP — DATABASE_URL is not configured
AdsPower: FAIL — local API fetch failed during current inspection
```

## Git

At last inspection, `.git` metadata was not found.

Therefore:
- no branch known;
- no HEAD baseline;
- no diff history.

Recommended if still true:
- initialize git;
- create baseline commit before large dashboard/AI changes.

## Important files

```text
README.md
package.json

apps/cli/src/index.ts
apps/cli/src/commands/data.ts
apps/cli/src/commands/sync.ts
apps/worker/src/index.ts

packages/seller-center/src/source/browser-source.ts
packages/seller-center/src/normalizers/orders.ts

packages/sync/src/index.ts

packages/db/src/schema.ts
packages/db/src/locks.ts
packages/db/src/queries/decisions.ts
packages/db/migrations/

packages/domain/src/decisions.ts
packages/domain/src/metrics/calculate.ts
packages/domain/src/risk-control.ts
packages/domain/src/recommendation/evaluate.ts
```

## Current high-priority gaps

1. Working live PostgreSQL E2E/migrations.
2. Critical Seller Center order status mappings.
3. Refund mapping.
4. Finance/settlement row mapping.
5. Carrier variants.
6. Pagination/full-history backfill.
7. V1 web dashboard and aggregate dashboard read model.
8. Baseline structured AI recommendation and AI decision provenance.
9. BA decision UI/mutation workflow using the implemented capture boundary.
10. Decision history queries and Rule-vs-AI-vs-BA comparison.
11. Separate DRY_RUN execution records and confirmation workflow.
12. Live PostgreSQL migration/transaction/rollback E2E.
13. Holiday Mode read/write discovery later; real execution remains out of current V1 scope.

## Latest milestone

Implemented and verified the V1 Decision Capture Foundation:

```text
Prepared aggregate snapshots
    + deterministic Rule Decision
    + BA decision / confidence / reason codes / note
    ↓ one database transaction
decision_cases
    + ba_decisions
```

Current limitations:

- No dashboard calls `captureBaDecision` yet.
- No decision-history read API/query exists yet.
- Append-only behavior is enforced by the public capture API and workflow; database triggers/roles do not currently reject direct table updates/deletes.
- Live PostgreSQL migration and rollback behavior remain unverified without `DATABASE_URL`.

## Current product priority change

Earlier dashboard work was considered deferrable.

That is NO LONGER TRUE.

Current V1 must visibly demonstrate:

```text
TikTok data
→ Metrics
→ Rule Result
→ AI Recommendation
→ Dashboard
→ BA Decision
→ DRY_RUN/Execution record
→ Decision Dataset
```

The dashboard is now a required V1 deliverable and the data-capture interface for future V2 AI.
