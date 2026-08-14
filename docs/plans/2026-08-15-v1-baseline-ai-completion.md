# V1 Baseline AI Completion Plan

> **For Codex:** Implement this plan task-by-task in the current session unless the user explicitly asks for delegated or parallel agent work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish and verify the existing uncommitted V1 baseline AI work, obtain an independent approval, and create one local commit without altering protected subsystems or configuration.

**Architecture:** Preserve the current separation between deterministic domain rules, the 9Router provider boundary, workflow orchestration, PostgreSQL persistence, and CLI presentation. Treat AI as advisory and fail closed whenever configuration, routing identity, response structure, or data coverage is insufficient.

**Tech Stack:** Node.js 22+, pnpm, strict TypeScript, ESM, Zod, Vitest, PostgreSQL, Drizzle ORM, Commander.

**Spec:** `CODEX_MASTER_CONTEXT.md` section 16, the current user Definition of Done, and the existing working-tree diff from `b483484`.

## Global Constraints

- Preserve all current WIP; do not reset, revert, stash, discard, switch branches, recreate, or overwrite it.
- Do not modify `apps/dashboard`, `packages/seller-center`, `packages/sync`, AdsPower/extraction, Codex config, or 9Router config.
- Use only verified free `oc/*` models through 9Router; reject `auto`, `cx/*`, paid, missing, or unverified routing identities.
- Keep Rule, AI, BA, and Execution separate; AI never changes deterministic rules or performs Seller Center actions.
- Preserve unknown and incomplete values explicitly; never fabricate safe values or zeroes.
- Never persist or transmit cookies, tokens, browser storage, buyer data, contacts, shipping addresses, or raw Seller Center data.
- Database changes must remain represented by Drizzle schema, migration SQL, snapshot metadata, and schema validation.
- Create one local AI commit only after all gates and reviewer approval; do not push.

---

### Task 1: Provider, Runtime, and Persistence Audit

**Files:**
- Review/modify if evidence requires: `packages/decision-ai/src/**`
- Review/modify if evidence requires: `packages/domain/src/decisions.ts`
- Review/modify if evidence requires: `packages/db/src/schema.ts`
- Review/modify if evidence requires: `packages/db/src/queries/decisions.ts`
- Review/modify if evidence requires: `packages/db/migrations/0013_sour_giant_man.sql`
- Test: corresponding existing `*.test.ts` and `*.integration.test.ts` files

**Interfaces:**
- Consumes: `BaselineAiInput`, `BaselineAiConfig`, immutable Decision Case snapshots.
- Produces: fail-closed `BaselineAiResult`, verified routing provenance, and persisted AI read contracts.

- [x] **Step 1: Run the targeted provider/runtime/domain/DB tests**

```powershell
pnpm exec vitest run packages/decision-ai/src/client.test.ts packages/decision-ai/src/runtime-v2.test.ts packages/domain/src/decisions.test.ts packages/db/src/queries/decisions.test.ts packages/db/src/queries/decisions.integration.test.ts
```

- [x] **Step 2: Inspect routing, schema, migration, and read-contract consistency**

```powershell
git diff -- packages/decision-ai packages/domain/src/decisions.ts packages/db/src/schema.ts packages/db/src/queries/decisions.ts packages/db/migrations
```

- [x] **Step 3: Reproduce observed defects in their narrowest existing tests before surgical production edits**

```powershell
pnpm exec vitest run packages/decision-ai/src/runtime-v2.test.ts packages/domain/src/decisions.test.ts packages/db/src/queries/decisions.test.ts
```

- [x] **Step 4: Re-run the affected test and package typecheck after each fix**

```powershell
pnpm --filter @shop-health/decision-ai typecheck
pnpm --filter @shop-health/db typecheck
```

### Task 2: CLI, Diagnostics, Smoke, and Documentation

**Files:**
- Review/modify if evidence requires: `apps/cli/src/commands/doctor.ts`
- Review/modify if evidence requires: `apps/cli/src/review-workflow.ts`
- Review/modify if evidence requires: `apps/cli/src/presentation/review.ts`
- Review/modify if stale: `.env.example`, `README.md`, `CURRENT_IMPLEMENTATION_STATUS.md`
- Test: corresponding existing CLI/workflow/presentation tests

**Interfaces:**
- Consumes: baseline AI config and persisted decision review models.
- Produces: sanitized diagnostics, stable CLI presentation, and accurate operational documentation.

- [x] **Step 1: Run targeted workflow, presentation, and doctor tests**

```powershell
pnpm exec vitest run packages/decision-workflow/src/workflow.test.ts packages/decision-workflow/src/presentation.test.ts apps/cli/src/review-workflow.test.ts apps/cli/src/presentation/review.test.ts apps/cli/src/commands/doctor.test.ts
```

- [x] **Step 2: Run CLI diagnostics without exposing secrets**

```powershell
pnpm shop-health doctor --json
```

- [x] **Step 3: Run a sanitized loopback request against the configured local 9Router endpoint and verify structured output plus terminal trailer handling**

```powershell
pnpm exec tsx .tmp-v1-ai-smoke.ts
```

- [x] **Step 4: Confirm routing and privacy properties from observable request/result behavior**

```powershell
pnpm exec vitest run packages/decision-ai/src/runtime-v2.test.ts
```

- [x] **Step 5: Update only documentation that contradicts the verified implementation**

```powershell
rg -n "opencode-zen|TOOL_AI_MODEL|MISSING_API_KEY|9router|TOOL_AI_DEFAULT_MODEL" README.md CURRENT_IMPLEMENTATION_STATUS.md .env.example
```

### Task 3: Repository Gates

**Files:**
- No planned source ownership; fix only failures attributable to the AI WIP within the allowed areas.

**Interfaces:**
- Consumes: completed working tree.
- Produces: fresh Definition of Done evidence.

- [x] **Step 1: Run typecheck**

```powershell
pnpm typecheck
```

- [x] **Step 2: Run the full test suite**

```powershell
pnpm test
```

- [x] **Step 3: Run the full build**

```powershell
pnpm build
```

- [x] **Step 4: Validate the Drizzle schema and migration metadata**

```powershell
pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts
```

### Task 4: Independent Review and Local Commit

**Files:**
- Review: complete diff from `b483484` plus all untracked AI files.
- Commit: only the verified V1 baseline AI WIP and its completion documentation.

**Interfaces:**
- Consumes: final diff and gate evidence.
- Produces: reviewer verdict and one local commit.

- [ ] **Step 1: Request read-only reviewer-luna review for correctness, architecture, routing safety, privacy, migration integrity, tests, and scope**

```text
Required verdict: APPROVE or REQUEST CHANGES with file/line findings.
```

- [ ] **Step 2: Address every required finding with a focused regression test and re-run affected plus full gates**

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts
```

- [ ] **Step 3: Verify final branch, status, and diff scope**

```powershell
git branch --show-current
git status --short
git diff --check
```

- [ ] **Step 4: Create one local commit and do not push**

```powershell
git add -- .env.example CURRENT_IMPLEMENTATION_STATUS.md README.md apps/cli packages/db packages/decision-ai packages/decision-workflow packages/domain docs/plans/2026-08-15-v1-baseline-ai-completion.md
git commit -m "feat: complete V1 baseline AI runtime"
```
