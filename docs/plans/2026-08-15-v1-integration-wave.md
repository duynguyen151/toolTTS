# V1 Integration Wave Implementation Plan

> **For Codex:** Implement this plan task-by-task in the current session unless the user explicitly asks for delegated or parallel agent work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the frozen AI and Dashboard waves, enrich the production AI context from verified persisted data, and prove the complete AdsPower-to-PostgreSQL-to-AI-to-Dashboard flow.

**Architecture:** Preserve the existing backend-first boundaries: Seller Center extraction normalizes and reconciles before persistence; domain code calculates deterministic metrics and Rule results; immutable Decision Cases produce strict allowlisted AI context; persisted AI decisions feed the Dashboard without collapsing Rule, AI, BA, or execution layers. Extend existing contracts additively and keep Seller Center extraction stable.

**Tech Stack:** Node.js 22, pnpm, strict TypeScript, ESM, Zod, PostgreSQL 16, Drizzle ORM, Vitest, Next.js, React, Playwright CDP, AdsPower Local API, 9Router, DeepSeek.

**Spec:** User-provided `V1 INTEGRATION WAVE — AI + DASHBOARD + LIVE DATA E2E` brief and AdsPower auto-open clarification in the active task.

## Global Constraints

- Work only on `codex/v1-integration`; preserve frozen commits `3fa4b58` and `72faddc` with full history.
- Do not push, use remotes, merge to master, amend frozen commits, or modify frozen source branches.
- Do not redesign extraction, pagination, normalization, finance reconciliation, authentication, or AdsPower acquisition.
- Never send raw Seller Center or Finance JSON, credentials, session material, PII, or CDP endpoints to AI or browser clients.
- Deterministic Rule results are immutable; AI recommendations remain advisory.
- `COMPLETE` means complete within the proven rolling 12-month source window and never lifetime-complete.
- No LIVE-to-DEMO fallback; incomplete required sources produce `PARTIAL` or `ERROR`.
- Use local environment configuration for `DATABASE_URL`; do not commit secrets.

---

### Task 1: Integrate Frozen Waves

**Files:** Git history and conflict-only documentation.

**Interfaces:**
- Consumes: frozen commits `3fa4b58` and `72faddc`.
- Produces: merge commits on `codex/v1-integration` with both commits as ancestors.

- [x] Merge the AI baseline commit without squashing or rebasing.
- [x] Merge the Dashboard presentation commit without squashing or rebasing.
- [x] Resolve conflicts narrowly and verify merge ancestry, clean status, `git diff --check`, targeted tests, and typecheck.

### Task 2: Persist Verified Decision Evidence

**Files:**
- Modify: `packages/domain/src/decisions.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/queries/decisions.ts`
- Modify: `packages/sync/src/index.ts`
- Test: corresponding domain, DB unit, and PostgreSQL integration tests.

**Interfaces:**
- Consumes: successful persisted sync runs, normalized finance snapshots, persisted order facts, deterministic Rule evaluation.
- Produces: an immutable typed Decision Case containing coverage, completeness, reconciliation, freshness, explicit order denominators, finance decomposition, and Rule evidence.

- [ ] Write failing tests for rolling-window coverage proof, freshness/reconciliation, order metric semantics, finance separation, and historical nullable compatibility.
- [ ] Add the minimum additive typed persistence and migration required to re-read verified evidence without guessing.
- [ ] Re-read Decision Case input from PostgreSQL and verify restart-safe persistence.

### Task 3: Enrich and Protect the AI Boundary

**Files:**
- Modify: `packages/decision-ai/src/contracts.ts`
- Modify: `packages/decision-ai/src/prompt.ts`
- Modify: `packages/decision-ai/src/client.ts`
- Modify: `packages/decision-workflow/src/workflow.ts`
- Test: decision AI and workflow tests.

**Interfaces:**
- Consumes: persisted Decision Case typed evidence.
- Produces: strict allowlisted sanitized AI context and a persisted AI Decision with provider/model provenance.

- [ ] Write failing tests proving prohibited PII, secrets, raw payloads, identifiers, and endpoints are rejected before network access.
- [ ] Expose explicit `totalPersistedOrders`, `operationalOrderCount`, `deliveredCount`, and `deliveryRate` semantics without changing Rule math.
- [ ] Expose official Finance On Hold separately from operational exposure and reason-level finance facts only when verified.
- [ ] Preserve null/unavailable cancellation, refund, and trend semantics unless reliable persisted facts exist.
- [ ] Persist the AI Decision and verify fresh reads return identical provenance and recommendation data.

### Task 4: Complete Dashboard Update Data Orchestration

**Files:**
- Modify: `apps/dashboard/lib/server/operations/dashboard-operations.ts`
- Modify: `apps/dashboard/lib/server/operations/runtime.ts`
- Modify: `apps/dashboard/lib/dashboard-read.ts`
- Test: Dashboard operations, runtime, route, and read-model tests.

**Interfaces:**
- Consumes: AdsPower launcher/client, Seller Center health/source, sync, deterministic evaluation, Decision Case/AI workflow, persisted Dashboard read model.
- Produces: `UPDATE DATA` flow from AdsPower readiness through exact-profile CDP readiness, complete live sync, Rule/AI persistence, and refreshed Dashboard data.

- [ ] Write a failing composed test for `AdsPower not ready -> launch -> API ready -> profile 957 CLOSED -> exact start -> CDP ready -> healthy session -> complete Orders -> complete Finance -> reconcile -> persist -> SUCCESS`.
- [ ] Preserve explicit launch/profile/CDP/login/challenge/sync failure codes and operator intervention through `OPEN PROFILE`.
- [ ] Prevent AI invocation and terminal success when any completeness or reconciliation gate fails.
- [ ] Keep internal AdsPower IDs, CDP endpoints, credentials, and session material server-only.

### Task 5: Present Separate Decision Layers

**Files:**
- Modify: `apps/dashboard/lib/dashboard-contract.ts`
- Modify: `apps/dashboard/lib/dashboard-model.ts`
- Modify: `apps/dashboard/components/dashboard/*`
- Test: Dashboard model/component/page tests.

**Interfaces:**
- Consumes: persisted Rule, AI Decision, BA Decision, execution record, coverage, order, and finance facts.
- Produces: accessible desktop/mobile presentation with distinct decision layers and accurate coverage/finance labels.

- [ ] Keep Rule Result, AI Recommendation, BA Decision, and Execution visually distinct.
- [ ] Show `Complete within proven source window`, `Last 12 months`, and `Lifetime history: not proven` where applicable.
- [ ] Label official Finance On Hold separately from operational order-derived exposure.
- [ ] Show supported AI recommendation, risk, confidence, reasons, factors, review flag, and provider/model provenance.
- [ ] Verify keyboard focus, semantics, responsive layout, and mobile presentation.

### Task 6: PostgreSQL and Live Runtime Verification

**Files:** Existing test suites and local environment only; no committed secrets.

**Interfaces:**
- Consumes: local `TEST_DATABASE_URL`, `DATABASE_URL`, AdsPower profile 957, authenticated Seller Center session, and strict 9Router configuration.
- Produces: evidence-backed DB persistence, restart-read, live sync, model provenance, and Dashboard read results.

- [ ] Run all PostgreSQL integration tests that otherwise skip without `TEST_DATABASE_URL`.
- [ ] Verify live sync persistence, Decision Case re-read, AI Decision persistence, restart-safe reads, Dashboard reads, and nullable historical rows.
- [ ] Run a sanitized 9Router smoke using provider `9router` and requested model `oc/deepseek-v4-flash-free`, with no fallback.
- [ ] Run profile 957 live E2E when AdsPower and authenticated Seller Center are available; report runtime blockers separately from code failures.

### Task 7: Final Review and Integration Commit

**Files:** All integration-specific changes only.

**Interfaces:**
- Consumes: completed implementation and verification evidence.
- Produces: reviewer-approved integration branch and one local integration commit.

- [ ] Run targeted tests, full tests, typecheck, build, Drizzle check, `git diff --check`, CLI doctor, and UI verification.
- [ ] Obtain a fresh read-only `reviewer-luna` verdict; fix bounded defects and re-review until approved.
- [ ] Create one local integration commit without pushing or amending frozen history.
