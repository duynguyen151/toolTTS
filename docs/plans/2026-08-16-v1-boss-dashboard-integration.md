# V1 Boss Dashboard Integration Implementation Plan

> **For Codex:** Implement this plan task-by-task in the current session unless the user explicitly asks for delegated or parallel agent work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the completed profile, decision, and dashboard waves into an honest, persisted V1 decision-support workflow.

**Architecture:** Preserve the frozen contracts and existing package boundaries. Work in vertical integration rounds: profile operations, decision capture, dashboard reads, and BA review/execution; each round is verified before the next. Backend/domain code remains authoritative and dashboard code renders backend read models and explicit failure states only.

**Tech Stack:** Node.js 22, pnpm, TypeScript ESM, Next.js dashboard, PostgreSQL/Drizzle, AdsPower/CDP, 9Router DeepSeek runtime, Vitest.

**Spec:** `docs/V1_MASTER_CONTEXT.md`; `packages/domain/src/contracts/v1-freeze.ts`; user-provided Boss Dashboard integration goal.

## Global Constraints

- Preserve V1: no HTTP product API beyond existing dashboard routes, Redis, queue, LLM decision authority, Seller Center writes, Holiday Mode, multi-region support, or parallel profile sync.
- Use `READY`/`ELIGIBLE` gates and verify only an explicitly selected profile; profile 957 is reference-only.
- Keep `operationalExposure` distinct from `officialFinanceOnHold`; domain/backend code owns all calculations.
- AI receives only `AiDecisionContext`, through the existing 9Router DeepSeek runtime, and its structured result/provenance is persisted.
- BA decisions require the configured actor, remain append-only, and bind executions to the exact revision; all executions are `DRY_RUN`.
- LIVE reads never silently fall back to fixtures; absent data must render an explicit honest state.
- Do not print secrets or session material. Do not make intermediate integration commits; create the single requested commit only after the release gate passes.

---

### Task 1: Profile and backend operation seam

**Files:**
- Modify as required: `packages/sync/src/profile-orchestration.ts`, `packages/sync/src/profile-verification.ts`, `packages/seller-center/src/adspower/client.ts`, `apps/dashboard/lib/server/operations/dashboard-operations.ts`, and their focused tests.

**Interfaces:**
- Consumes: dynamic AdsPower inventory and the existing single-profile Seller Center sync pipeline.
- Produces: server-authoritative `OPEN`, `VERIFY`, `UPDATE DATA`, `SYNC SELECTED`, and sequential `SYNC ALL ELIGIBLE` operations with isolated failures.

- [ ] Write focused failing tests for explicit-profile verification, eligibility rejection, sequential batch continuation, and no reference-profile default.
- [ ] Run the focused tests and confirm the expected behavior gap.
- [ ] Implement the smallest wiring change that passes the tests without introducing Seller Center writes.
- [ ] Run the focused tests, inspect operation results, and require concurrency one.

### Task 2: Persisted deterministic decision pipeline

**Files:**
- Modify as required: `packages/decision-workflow/src/decision-intelligence.ts`, `packages/decision-workflow/src/persisted.ts`, `packages/domain/src/risk-control.ts`, `packages/decision-ai/src/*`, `packages/db/src/queries/decisions.ts`, and focused tests.

**Interfaces:**
- Consumes: persisted Orders/Finance snapshots for a verified shop.
- Produces: an immutable decision case containing metrics, comparison/trend evidence, deterministic rule result, sanitized AI context, and persisted AI analysis/provenance.

- [ ] Write failing tests for exposure/finance separation, rule evidence, unconfigured trend policy, sanitized AI input, and persisted AI provenance.
- [ ] Run the focused tests to verify the required failure.
- [ ] Implement only the missing data-flow seam or validation.
- [ ] Re-run focused tests and database integration tests with `TEST_DATABASE_URL` when configured.

### Task 3: Honest dashboard read and action wiring

**Files:**
- Modify as required: `apps/dashboard/lib/dashboard-read.ts`, `apps/dashboard/lib/dashboard-model.ts`, `apps/dashboard/app/dashboard/page-data.ts`, `apps/dashboard/components/dashboard/*`, `apps/dashboard/components/operations/*`, and focused tests.

**Interfaces:**
- Consumes: persisted `ShopHealthSnapshot` and profile operation results.
- Produces: real multi-profile control center and shop decision center whose controls call supported server operations and whose unavailable/incomplete/error states are explicit.

- [ ] Write failing server/component tests proving LIVE mode does not use a fixture and all displayed rule/AI/BA/execution values come from the read model.
- [ ] Run the focused tests to verify the required failure.
- [ ] Implement only the necessary read-model/action/error-state adapters.
- [ ] Re-run focused tests including keyboard/accessibility coverage.

### Task 4: Review queue, append-only BA decisions, and dry-run execution

**Files:**
- Modify as required: `packages/db/src/queries/decisions.ts`, `packages/decision-workflow/src/presentation.ts`, `apps/dashboard/lib/dashboard-read.ts`, dashboard BA components, and focused tests.

**Interfaces:**
- Consumes: latest immutable decision cases and `TOOL_BA_ACTOR`.
- Produces: exception-only review queue, validated append-only BA revisions, durable history, and a `DRY_RUN` execution tied to the exact BA revision.

- [ ] Write failing tests for healthy exclusion, each exception route, actor absence, `OTHER` notes, history reload, and exact execution binding.
- [ ] Run the focused tests to verify the required failure.
- [ ] Implement the smallest server-authoritative behavior.
- [ ] Re-run focused and PostgreSQL integration tests when test configuration is present.

### Task 5: Release verification and independent review

**Files:**
- Modify only defects found in Tasks 1-4; do not change locked contracts without a genuine contradiction.

- [ ] Run environment-presence/connectivity checks without printing values; classify any missing prerequisite as unavailable, not passing.
- [ ] Run targeted integration, dashboard, BA-history, accessibility, AdsPower-safe, and sanitized DeepSeek tests where configuration is available.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts`, and `git diff --check`.
- [ ] Obtain independent conventional and adversarial reviews, adjudicate every material finding, and repair accepted blocker/high findings.
- [ ] Re-run affected verification and create only `feat: integrate V1 boss decision dashboard` if every required gate has evidence.
