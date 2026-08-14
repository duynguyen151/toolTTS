# Tool_TTS - Current Implementation Status

> Update this file whenever the implementation materially changes.
> This is operational state, not long-term product strategy.

## Repository

```text
C:\DUY - DoWorks\Tool_TTS
```

- Git branch: `master`
- Baseline commit: `273573b baseline: V1 decision capture foundation`
- No Git remote or push is configured for this wave.

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

- AdsPower was intentionally not used for this decision-workflow wave.
- Final diagnostics found the local AdsPower API reachable; no profile was opened or manipulated.
- No replacement scraper, login flow, or alternate live data source was added.
- No Seller Center request is made by the review/decision/execution path.
- Live Seller Center validation: `NOT RUN - AdsPower intentionally disabled`.
- Holiday Mode remains DRY_RUN only.

## Deferred scope

The Dashboard Presentation Wave remains deferred until a UI reference is
provided. This wave does not add Next.js, Tailwind, shadcn, TanStack Table,
Poppins, Heroicons, Recharts, an HTTP API, Redis, a queue, RAG, pgvector,
Mastra, LangChain, or fine-tuning.

Future dashboard code should consume the stable decision presentation schemas
and must not reimplement deterministic rules or workflow persistence.

## Known live-data gaps

- Seller Center status mappings other than confirmed code `101`.
- Refund and settlement-row mappings.
- Carrier variants.
- Pagination/export request mapping and full-history backfill.
- Holiday Mode live route/state/write discovery.
- Proof of complete historical coverage.

`sync backfill` remains disabled with `BACKFILL_UNRESOLVED`.

## Verification

Final local verification on 2026-08-14:

```text
pnpm typecheck: PASS
pnpm test: PASS (135/135)
pnpm build: PASS, including plain Node CLI postbuild smoke
pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts: PASS
pnpm db:migrate: PASS
pnpm db:seed:demo: PASS twice, idempotent
pnpm shop-health doctor --json: Node OK, PostgreSQL OK, AdsPower API OK,
  baseline AI SKIP because TOOL_AI_API_KEY is missing
```

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
