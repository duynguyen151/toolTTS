# V1 Decision Capture Foundation Implementation Plan

> **For Codex:** Implement this plan task-by-task in the current session unless the user explicitly asks for delegated or parallel agent work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the smallest persistent V1 decision-data slice: an immutable shop-state case and an append-only BA decision recorded atomically.

**Architecture:** Keep decision vocabulary and boundary validation in `packages/domain`, and keep PostgreSQL schema/query implementation in `packages/db`. Capture metrics, deterministic rule, finance, and source provenance as JSON snapshots so historical BA decisions never depend on current mutable shop state. AI decisions and execution records remain separate future tables rather than being collapsed into this milestone.

**Tech Stack:** Node.js 22, strict TypeScript, ESM, Zod, PostgreSQL 16+, Drizzle ORM, Vitest, pnpm.

**Spec:** `docs/context/codex-master-context.md` sections 12-15 and `docs/context/ui-dashboard-requirements.md` sections 12-14.

## Global Constraints

- `packages/domain` remains pure and deterministic; it must not depend on database, browser, UI, network, or LLM implementations.
- Rule result, AI recommendation, BA decision, and execution remain distinct concepts.
- Decision-time state is stored as an immutable snapshot and is never reconstructed from current metrics.
- Holiday Mode remains `DRY_RUN`; this milestone performs no Seller Center writes.
- Unknown/incomplete values remain explicit and are not fabricated as zero or safe data.
- Database schema changes require a Drizzle migration and schema validation.
- Timestamps use PostgreSQL `timestamptz` and UTC semantics.
- No cookies, tokens, browser storage, buyer names, contact details, or shipping addresses are stored.

---

## 1. Verified Current State

- `apps/cli`, `apps/worker`, `packages/domain`, `packages/db`, `packages/seller-center`, and `packages/sync` are the only implementation workspaces.
- Seller Center collection, normalization, PostgreSQL persistence, deterministic metrics, deterministic health recommendation, risk evaluation, CLI, and worker orchestration exist.
- `risk_control_states.decision` stores only the latest mutable deterministic risk state per shop.
- `decision_cases`, `ba_decisions`, `ai_decisions`, and `decision_executions` do not exist.
- No dashboard, product HTTP interface, LLM integration, or UI assets exist.
- Node `v22.20.0` and pnpm `11.19.0` are installed; workspace dependencies are installed.
- Git metadata is absent.
- `DATABASE_URL` is absent; AdsPower diagnostics currently fail to connect.
- Baseline evidence: `pnpm typecheck`, `pnpm test` (41/41), and Drizzle schema check pass.

## 2. Context Conflicts

- `AGENTS.md` and `README.md` describe V1 as having no web UI or LLM, while the master context, UI requirements, and current user request explicitly expand V1 to require a dashboard and AI recommendation. The current request authorizes that expansion; deterministic domain and no-automatic-action boundaries remain in force.
- Historical live-profile claims in `docs/context/current-implementation-status.md` cannot be reproduced in the current environment because AdsPower is unavailable and `DATABASE_URL` is not configured.

## 3. V1 Gap Map

- **Data acquisition — PARTIAL:** one-page orders and finance summary collection exist; pagination, status/refund/settlement mapping, and full coverage remain unresolved.
- **PostgreSQL — PARTIAL:** operational backend tables and migrations exist; decision dataset tables do not.
- **Metrics — DONE:** deterministic metrics and warnings exist with unit coverage.
- **Rule Engine — DONE:** deterministic OR thresholds, insufficient-data handling, and DRY_RUN output exist with unit coverage.
- **Decision Case Capture — NOT STARTED:** no immutable composite decision snapshot exists.
- **Dashboard — NOT STARTED:** no frontend workspace or dependencies exist.
- **AI Recommendation — NOT STARTED:** the existing health recommendation is deterministic and must not be labeled AI.
- **BA Decision — NOT STARTED:** no contract, storage, or mutation boundary exists.
- **Decision History — NOT STARTED:** no append-only case or decision queries exist.
- **Execution/DRY_RUN — PARTIAL:** deterministic evaluation reports DRY_RUN/NONE, but no separate execution history entity exists.

## 4. Immediate Critical Path

```text
Decision Case + BA Record
    -> dashboard read model and BA workflow
    -> structured AI recommendation record
    -> Rule vs AI vs BA history
    -> separate DRY_RUN execution record
```

This is the smallest path to a trustworthy demo because the dashboard cannot save its primary workflow until immutable decision storage exists.

## 5. Subagent Task Split

- **Explorer / Backend-Data:** completed read-only verification of collection, sync, persistence, metrics, risk, tests, and runtime blockers.
- **Explorer / Decision Model:** completed read-only verification of schema, migrations, mutability, and missing decision entities.
- **Explorer / Dashboard:** completed read-only verification of frontend/API/dependency absence and existing server-side read seams.
- **Coder / Decision Capture:** implement only the domain contracts, DB schema/migration, atomic capture query, and targeted tests described below.
- **Reviewer / Diff:** read-only review for correctness, immutability, schema integrity, public contracts, and scope control.

## 6. Exact Files Likely Affected

- Create `packages/domain/src/decisions.ts`.
- Modify `packages/domain/src/index.ts`.
- Create `packages/domain/src/decisions.test.ts`.
- Modify `packages/db/src/schema.ts`.
- Create `packages/db/src/queries/decisions.ts`.
- Modify `packages/db/src/index.ts`.
- Create the next generated migration under `packages/db/migrations/` and its Drizzle metadata.
- Create `packages/db/src/queries/decisions.test.ts` only if a database-independent query contract test can assert real behavior; otherwise test the atomic query against live PostgreSQL when `DATABASE_URL` becomes available.
- Update `docs/context/current-implementation-status.md` after verification.

## 7. Dependencies

- **ADD:** none for this milestone; Zod, Drizzle, PostgreSQL driver, and Vitest already exist.
- **DEFER:** Next.js, React, React DOM, Heroicons, TanStack Table, selected shadcn/Tailwind primitives until the dashboard milestone.
- **DEFER:** Vercel AI SDK/provider integration until the AI record contract and provider choice are implemented.
- **DEFER:** Recharts until verified trend history provides direct BA value.
- **REJECT:** Redis, BullMQ, Trigger.dev, Refine, Mastra, pgvector, and a separate vector database for the current milestone.

## 8. Milestones

### Milestone 1: Decision Contracts

**Goal:** Define stable validated vocabulary for BA decisions, reason codes, coverage, and immutable decision-case input.

**Implementation scope:** Add Zod schemas/types in `packages/domain/src/decisions.ts` and export them through `packages/domain/src/index.ts`.

**Acceptance criteria:** Invalid decisions, confidence outside 0-1, blank notes, invalid reason codes, and malformed snapshots are rejected; valid SCALE/CONTINUE/WATCH/PAUSE inputs parse.

**Validation:** Run `pnpm test packages/domain/src/decisions.test.ts` and `pnpm --filter @shop-health/domain typecheck`.

**DONE condition:** Tests are observed failing before implementation, then pass with the minimal exported contracts.

### Milestone 2: Immutable Case + BA Schema

**Goal:** Persist decision-time context separately from the BA decision.

**Implementation scope:** Add `decision_cases` and `ba_decisions` with UUID primary keys, indexed foreign keys, JSONB snapshots, explicit rule/coverage fields, confidence constraints, nonblank policy/source fields, and no update/delete query APIs. Generate the next Drizzle migration.

**Acceptance criteria:** Schema preserves shop/source-run provenance, case snapshots, rule result/triggers, coverage, and one append-only BA record per submission; no AI or execution fields are folded into either table.

**Validation:** Run domain/DB typecheck and `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts`.

**DONE condition:** Drizzle schema and generated migration agree and all constraints/indexes are present.

### Milestone 3: Atomic Capture Boundary

**Goal:** Make the BA workflow hard to misuse by inserting the case and BA decision in one transaction.

**Implementation scope:** Add `captureBaDecision` in `packages/db/src/queries/decisions.ts`; validate input with domain schemas at the boundary, insert the immutable case, insert the linked BA decision, and return both rows.

**Acceptance criteria:** A caller cannot save a BA decision without a case; failed BA insertion rolls back the case; the API exposes no update/delete operation; source sync run remains nullable when provenance is unavailable.

**Validation:** Typecheck and targeted tests; DB E2E only if a working `DATABASE_URL` is available.

**DONE condition:** The public DB package exports the atomic capture function and row/input types with no dependency inversion violation.

### Milestone 4: Verification and Status Memory

**Goal:** Verify the increment and record only proven state.

**Implementation scope:** Independent review, full commands, and `docs/context/current-implementation-status.md` update.

**Acceptance criteria:** No required review findings remain; status file distinguishes code/schema validation from unavailable live DB E2E.

**Validation:** `pnpm typecheck`, `pnpm test`, `pnpm build`, Drizzle schema check, and DB E2E when possible.

**DONE condition:** Fresh command evidence is captured; if no database is available, status explicitly says `DB E2E: NOT RUN - no working DATABASE_URL`.

## 9. Critical Unknowns

- Live PostgreSQL migration and transaction behavior cannot be verified without `DATABASE_URL`.
- Product policy for BA corrections/supersession is not defined; this milestone treats every BA submission as append-only and exposes no mutation API.
- AI provider/model/prompt version are intentionally deferred; deterministic health recommendations remain labeled deterministic, not AI.
- Dashboard authentication/authorization is not specified and will need a decision before a production mutation interface is exposed.

