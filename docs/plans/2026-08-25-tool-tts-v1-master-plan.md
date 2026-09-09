# Tool_TTS V1 Master Plan

> **For implementation workers:** This is the locked V1 implementation planning authority. Execute one bounded task at a time in a fresh execution session. Use `subagent-driven-development` or `executing-plans` as directed by the Technical Director. SOL completed discovery and planning only and must not implement this plan.

**Status:** APPROVED AND LOCKED (amended 2026-08-28)
**Planning baseline:** Approved Project Reality Report from the SOL planning session
**Goal:** Extend the existing Tool_TTS system into a provider-aware, Official-Finance-On-Hold-driven, policy-configurable, CLI-first V1 while preserving every proven Seller Center, persistence, deterministic-rule, AI-safety, BA-history, and DRY_RUN foundation.
**Architecture:** Extend the existing `SellerDataSource` and canonical-domain seams rather than introducing microservices, an event bus, Redis, or a distributed queue. Use COTIK as the primary normal-path candidate for Orders and as supplementary Finance only. Seller Center remains the currently proven authoritative Official Finance On Hold source. Every review follows deterministic facts → effective policy → deterministic Rule → requested AI task resolution → frozen immutable Decision Case and `AiDecisionContext` → linked AI Decision → append-only BA revision.
**Tech stack:** Node.js 22+, pnpm 11, strict TypeScript/ESM, Zod, PostgreSQL 16, Drizzle ORM, Vitest, Commander, Next.js 16, React 19, Playwright CDP, AdsPower Local API, and configurable server-side AI providers.
**Authoritative inputs:** `Tool_TTS_V1_Master_Prompt_revised.md`, the approved Project Reality Report, `docs/integrations/cotik/public-api-guide.md`, `AGENTS.md`, `docs/context/v1-master-context.md`, and current source/tests.

**Locked amendment (2026-08-28):** W9-T02 accepts manual bootstrap as its V1 completion mode: after an operator completes ordinary login outside Tool_TTS, Tool_TTS must rerun canonical Seller Center verification and prove the exact linked TikTok Shop identity before collection. Safe autofill auto-login remains conditional on a verified real capability and is not a V1 acceptance blocker. This amendment does not permit credential reading/injection, selector guessing, challenge bypass, trusting manual completion without re-proof, or identity guessing.

## Global Constraints

- Use the smallest additive change. Do not redesign or rewrite a working subsystem when an existing seam can be extended.
- Preserve all useful existing data and behavior. No destructive schema rename/drop is allowed in V1.
- Official Finance On Hold and Operational Exposure are separate values. Operational Exposure remains stored and useful for context/trends but is not the target money-threshold Rule input.
- COTIK statements/payments are supplementary Finance. They must not be labeled or derived as Official Finance On Hold without a future documented contract and exact reconciliation proof.
- Seller Center is currently the authoritative Official Finance On Hold provider. Configured checkpoints may trigger an authoritative Seller Center refresh; this is not fallback from a proven COTIK Official-OH value.
- The target deterministic Rule uses Official Finance On Hold plus authoritative Delivery Rate under an effective revisioned policy.
- AI is advisory. BA is final. No Seller Center or COTIK business action is executed in V1.
- Preserve all existing DRY_RUN-only database constraints and historical DRY_RUN records.
- Business timezone is GMT+07 (`Asia/Bangkok` is the existing IANA configuration). Today, analytical period boundaries, scheduling, fallback checkpoints, and BA-visible timestamps use GMT+07.
- US proxy, AdsPower browser timezone, seller geography, server local timezone, or exit IP must never redefine the Tool_TTS business timezone.
- `08:00`, `11:00`, and `17:00` are editable seed/default wall-clock checkpoints in GMT+07. They are not hard-coded business constants and are not stale-age durations.
- Global default plus optional SHOP override is the complete V1 risk-policy inheritance model. Do not add seller/person/BA policy hierarchy.
- AI recommendation confidence is model-reported confidence, not a calibrated probability. Deterministic Data Quality is a separate concept and must never be collapsed into the same score.
- Order list/read models remain privacy-minimized. AI context and future training/BA-learning data are strictly PII-free by default.
- Order Detail may expose operationally required customer fields only through a dedicated server-side, access-controlled, data-minimized projection. Such fields must not be copied into AI context, immutable learning cases, logs, or unnecessary list payloads.
- COTIK tokens, AI keys, proxy credentials, AdsPower secrets, cookies, browser sessions, and TikTok credentials stay server-side. Do not commit, log, browser-expose, add to AI prompts, or duplicate them into Decision Cases.
- The approved worktree baseline was 28 modified tracked files and 16 untracked status entries. Preserve unrelated WIP; do not clean, reset, switch, merge, or rewrite it.
- AdsPower LIVE validation is environment-gated. An unavailable AdsPower environment is `BLOCKED_BY_ENVIRONMENT`, not a reason to weaken code or block architecture work.
- CloakBrowser research is optional and non-gating. It is excluded from V1 readiness and Definition of Done.

---

# PART A — DISCOVERY

## 1. Skill / Tool / Subagent Usage

Phase 1 used repository and global instructions plus the following skills where applicable: `harness-engineering`, `writing-plans`, `dispatching-parallel-agents`, `codebase-design`, `api-and-interface-design`, `nodejs-backend-patterns`, `adspower-browser`, and `playwright-best-practices`.

Six read-only discovery agents investigated:

1. repository, architecture, contracts, and database;
2. Seller Center, AdsPower, and Finance;
3. Orders, domain metrics, and deterministic rules;
4. AI, BA, CLI, Dashboard, and settings;
5. the complete COTIK public API guide;
6. automated verification and environment gates.

The main SOL agent verified important findings through source reads, tests, Git inspection, CLI diagnostics, and read-only PostgreSQL queries. Phase 2–5 reused that evidence. No implementation or repository modification occurred during planning.

## 2. Repo / Worktree Reality

- Worktree: `C:\DUY - DoWorks\Tool_TTS-boss-merge`
- Branch: `codex/v1-boss-dashboard-merge`
- HEAD at discovery: `c2f14d41100fffcdd96a311bb4d69515d59f8c10`
- HEAD subject: `fix(seller-center): track Orders pagination source contract`
- Approved dirty baseline: 28 modified tracked files and 16 untracked status entries.
- No remote was configured during discovery.
- No checkout, switch, merge, amend, reset, cleanup, or unrelated-file action was performed.

The current worktree includes uncommitted Dashboard/operations work and the untracked authoritative COTIK guide. Implementers must inspect the exact current status before each bounded task and preserve unrelated ownership.

## 3. Approved Project Reality Report Baseline

The complete Project Reality Report delivered and approved in the planning session is the current-state baseline. Its critical findings remain unresolved evidence, not assumptions to erase:

- Profile 957 has Official Finance On Hold snapshot `$524.28`, persisted aggregate rows `$523.87`, and delta `$0.41`.
- COTIK Official Finance On Hold equivalence is `UNPROVEN`.
- The current Rule uses order-derived Operational Exposure. This is current reality, not the locked target Rule.
- The current BA enum lacks `SLOW_SELL`.
- Settings, configurable fallback checkpoints, proxy preflight, `deactive` policy, normal auto-login, a COTIK adapter, Order Explorer, and multi-task AI settings are missing or partial.
- Fresh AdsPower LIVE validation was `BLOCKED_BY_ENVIRONMENT`.

## 4. Existing End-to-End Flow

```text
AdsPower Local API
→ exact AdsPower profile reuse/start
→ Playwright connectOverCDP
→ canonical Seller Center route and Shop identity proof
→ canonical Orders/Finance network responses
→ normalization
→ transactional PostgreSQL persistence
→ current deterministic operational Rule
→ frozen Decision Case
→ optional linked 9Router AI Decision
→ append-only BA revisions
→ optional DRY_RUN record
→ CLI/Dashboard/history presentation
```

## 5. Existing Architecture Map

```text
packages/domain
  pure canonical contracts, metrics, recommendations, rules

packages/db
  PostgreSQL/Drizzle schema, migrations, locks, queries
  depends on domain

packages/seller-center
  AdsPower/CDP extraction and normalization
  depends on domain

packages/sync
  source orchestration, identity gates, locks, persistence
  depends on db + domain + seller-center

packages/decision-ai
  structured advisory provider/client contracts
  depends on domain

packages/decision-workflow
  Decision Case, AI, BA, history orchestration
  depends on db + domain + decision-ai

apps/cli | apps/worker | apps/dashboard
  application composition and presentation
```

Primary shared seams:

- `SellerDataSource`
- canonical Orders and Finance schemas
- `evaluateRiskControlFacts`
- frozen `AiDecisionContext`
- `DecisionCaseInputSchema`
- Drizzle schema/migrations
- Dashboard read contracts

## 6. Proven Working Capabilities

The following are proven foundations and must not be rebuilt:

1. AdsPower exact-profile reuse/start and CDP attachment.
2. Canonical Seller Center navigation and identity verification.
3. Orders cursor pagination, deduplication, no-progress/loop protection, and total-count reconciliation.
4. Seller Center Official Finance On Hold capture, Finance pagination, duplicate protection, and exact-decimal reconciliation.
5. Transactional advisory locks, idempotent upserts, stale-write protection, and sync audit.
6. Existing distinction between Official Finance On Hold and Operational Exposure in Finance/frozen contracts.
7. Deterministic fail-closed domain behavior for unknown status, currency mismatch, and insufficient data.
8. Frozen AI context validation, provider provenance, structured-output validation, and privacy tests.
9. Immutable Decision Cases, append-only BA history, idempotent linked records, and DRY_RUN-only execution.
10. Existing CLI and Dashboard server composition seams.

## 7. Current Tests / Runtime Evidence

Fresh planning verification established:

- `pnpm typecheck`: PASS for nine workspace projects.
- `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts`: PASS.
- Final `pnpm test`: 64 files passed, 7 skipped; 555 tests passed, 10 skipped.
- A prior run exposed timing-sensitive mocked browser failures; focused and full reruns passed. Treat that as a flakiness signal when browser timing code changes.
- PostgreSQL connectivity passed.
- Persisted successful sync evidence exists for profiles 947, 957, 976, 980, and 987 as detailed in the approved Project Reality Report.
- Integration tests requiring `TEST_DATABASE_URL` were skipped and must not be reported as executed.

## 8. Current Environment Blockers

- AdsPower `/status` was unavailable during discovery.
- Current profile/proxy/tag/session state could not be freshly proven.
- No fresh external AI provider invocation was performed.
- No COTIK token/runtime call was performed.

These are LIVE acceptance gates, not blockers for implementation planning or non-LIVE implementation waves.

---

# PART B — SYNTHESIS

## 9. Locked Requirement Summary

- AI advises; BA decides; V1 performs no autonomous seller action.
- The target Rule uses Official Finance On Hold and authoritative Delivery Rate under effective configurable policy.
- Operational Exposure remains a separate stored/context/trend metric.
- BA decisions are `SCALE`, `CONTINUE`, `SLOW_SELL`, `WATCH`, and `PAUSE`.
- `SLOW_SELL` is distinct from `WATCH` and stores planned methods without executing them.
- Orders are a first-class dataset with status distribution, analytical periods, search, pagination, and detail.
- COTIK is preferred only for capabilities proven by its contract.
- COTIK Orders are a primary normal-path candidate.
- COTIK statements/payments are supplementary Finance.
- Seller Center remains the currently proven authoritative Official Finance On Hold provider.
- Settings persist global/shop policy, caution policy, fallback schedule/retries, and AI task configuration.
- Fixed checkpoints are editable GMT+07 wall-clock times; default retry offsets are 0s, 30s, 2m, 5m, and 10m.
- `deactive` excludes routine automatic work while preserving history and manual operations.
- Existing authenticated sessions and manual bootstrap followed by canonical identity re-proof are valid V1 paths. Safe autofill auto-login is allowed only when a verified credential capability exists. CAPTCHA/security challenges require manual action.
- Historical review cases remain immutable and privacy-minimized.

## 10. Requirement → Current State → Gap Matrix

| Requirement | Current state/evidence | Classification | Exact gap | Risk |
|---|---|---|---|---|
| Provider-neutral acquisition | `SellerDataSource` exists, but coverage/Finance literals are Seller Center-specific | EXTEND | Provider identity, capabilities, provenance, COTIK adapter | HIGH |
| COTIK HTTP behavior | Guide only | ADD | Client, envelope validation, rate/retry behavior | MEDIUM |
| COTIK Orders | Seller Center Orders only | ADD | Binding, mapping, `totalsize` pagination, incremental cursor | HIGH |
| Seller Center Official OH | Proven collector and reconciliation | KEEP/EXTEND | Capability provenance, health, capture/read scope | HIGH |
| COTIK Finance | No runtime source | ADD/VERIFY | Supplementary statements/payments only | HIGH semantic risk |
| Profile 957 reconciliation | `$524.28` snapshot vs `$523.87` aggregate | VERIFY | Root cause and smallest capture/read/version fix | HIGH |
| Canonical statuses | Safe but incomplete enum/mapping | EXTEND | `UNPAID`, `ON_HOLD`, `AWAITING_COLLECTION`, explicit unknown | HIGH |
| Authoritative Delivery Rate | Current operational formula exists | EXTEND | Explicit counts/contract and provider mappings | MEDIUM |
| Target deterministic Rule | Current threshold uses Operational Exposure | SUPERSEDE for new reviews; KEEP history | Versioned Official-OH Rule | HIGH |
| Global/shop policy | Source constant | ADD | Immutable revisions, resolver, Settings | HIGH |
| Caution policy | Missing | ADD | Configured absolute/relative policy; no invented number | MEDIUM |
| Finance health/provenance | Partial timestamps and coverage | EXTEND | Provider/capability, age, quality, refresh state | HIGH |
| Checkpoints/retries | Missing | ADD | GMT+07 schedule, attempts, audit, manual path | HIGH |
| `deactive` policy | Tags readable only | ADD | Eligibility exclusion and manual override | MEDIUM |
| Proxy preflight | Sanitized timeout detection only | ADD/VERIFY | Server-side capability and observable states | HIGH |
| Auth recovery | Detection only | EXTEND | Credential capability, bounded login, typed states | HIGH |
| CloakBrowser | No integration | VERIFY/DEFER | Optional isolated POC, non-gating | MEDIUM |
| AI task registry | Single env-based 9Router task | EXTEND | Persisted task config, provider factory, test connection | HIGH |
| AI with stale Finance | Current client rejects stale | EXTEND | Honest stale advisory with deterministic quality | HIGH |
| Confidence vs quality | Internally separate, presentation incomplete | EXTEND | Explicit model-reported label and quality DTO | MEDIUM |
| BA `SLOW_SELL` | Four-value enum | ADD | Enum, methods, validation, CLI/Dashboard | HIGH |
| Immutable history | Case trigger and BA revisions exist | KEEP/EXTEND | Snapshot new policy/health/requested AI config metadata | HIGH |
| Trends | Objective comparison exists | EXTEND | Snapshot cadence and analytical periods | MEDIUM |
| CLI E2E | Individual commands exist | EXTEND | Guided complete flow, settings/manual refresh | MEDIUM |
| Dashboard | Working overview/read model | EXTEND | Timebase clarity, Order Explorer, Settings | MEDIUM |
| AI/training privacy | Strong allowlists/tests | KEEP | Preserve while allowing minimized operational Order Detail | HIGH |

## 11. KEEP / EXTEND / ADD / VERIFY / SUPERSEDE / DEFER

### KEEP

- Seller Center Official Finance On Hold collector.
- Finance pagination and exact reconciliation.
- Orders pagination and reconciliation.
- Profile identity gates.
- Locks, idempotent persistence, and audit.
- Official Finance/Operational Exposure separation.
- Immutable Case and append-only BA history foundations.
- AI frozen-context validation and privacy protections.
- DRY_RUN-only constraints.
- Existing CLI/Dashboard composition seams.

### EXTEND

- `SellerDataSource` capability/provenance contracts.
- Canonical order statuses.
- Finance health and capture/read semantics.
- Deterministic metrics and versioned Rule.
- Effective policy snapshots.
- AI registry/context/explanations.
- BA persistence/read contracts.
- CLI and Dashboard contracts.
- Historical snapshots and analytical periods.

### ADD

- COTIK client, bindings, Orders ingestion, and supplementary Finance ingestion.
- Policy revision tables/resolver/Settings.
- Fallback/refresh schedule and state machine.
- Proxy preflight.
- `deactive` gate.
- Normal auth recovery.
- `SLOW_SELL` and planned methods.
- Order Explorer.
- Minimal functional Settings UI.

### VERIFY

- Profile 957 `$0.41` root cause.
- AdsPower server-side proxy capability.
- Normal-login selectors and safe credential availability.
- COTIK runtime payload/rate headers/freshness fields.
- CloakBrowser feasibility as optional research.
- LIVE AdsPower/COTIK/AI behavior when environments become available.

### SUPERSEDE

- New reviews must not use Operational Exposure as the money threshold.
- Old “Onhold = order sum” terminology is no longer target semantics.
- Current hard rejection of every stale Official-OH snapshot is superseded by deterministic stale-value evaluation and honest advisory handling.
- Historical Auto Holiday/Resume/Pause execution requirements are superseded.
- README claims that Dashboard/HTTP routes do not exist are stale.

### DEFER

- COTIK tracking/price/stock writes.
- Seller Center business actions.
- CAPTCHA bypass.
- Production CloakBrowser migration.
- Calibrated AI confidence.
- RAG/fine-tuning/autonomous learning.
- Seller/person policy hierarchy.
- Broad CRM/RBAC development.
- Polished final Dashboard.

## 12. Conflicts Found

1. Current Rule uses Operational Exposure; locked target uses Official Finance On Hold.
2. Current BA enum lacks `SLOW_SELL`.
3. Current AI rejects stale Finance; target permits and requires honest stale-snapshot reasoning.
4. Provider seam exists, but source/coverage literals remain Seller Center-centric.
5. README/current status documentation contains stale Dashboard, pagination, and BA-history statements.
6. Dashboard can mix current facts with latest immutable Case values without consistently labeling timebase.
7. Repository standing scope originally excluded UI/LLM work, but the current Master Prompt explicitly expands V1 scope; the direct user requirement governs.

## 13. Superseded Old BA Requirements

Auto Holiday Mode, Auto Resume, Auto Pause, automatic action execution, order-derived “Official On Hold,” and AI-as-final-authority are superseded. Existing DRY_RUN records remain historical/audit data but do not authorize execution.

## 14. Existing Behavior That Must Be Preserved

All proven capabilities in Part A §6 are mandatory regression gates. No task may weaken Finance proof, unknown-status handling, profile identity verification, PII/secret minimization, immutable history, or DRY_RUN-only behavior.

## 15. Remaining Assumptions Needing Proof

- COTIK runtime follows the guide and provides no undocumented Official-OH or upstream-sync timestamp contract.
- AdsPower can provide a safe server-side proxy test or enough proxy data without browser exposure.
- A future normal auto-login attempt can use a verified safe credential/autofill seam without extracting plaintext credentials; its absence is not a V1 blocker because manual bootstrap plus canonical re-verification is a valid completion mode.
- Profile 957 mismatch is caused by capture/read/snapshot/version semantics rather than a failure of source reconciliation.
- The exact operational customer fields needed in V1 Order Detail can be minimized and served through an existing server-side guard.

## 16. TRUE Blockers

None for beginning bounded implementation. AdsPower/COTIK/AI LIVE access blocks only corresponding LIVE evidence. Missing credential or proxy capability must produce typed unavailable/manual states rather than weakened behavior.

---

# PART C — TARGET

## 17. Minimal Additive Target Architecture

```text
COTIK Orders adapter ───────────────┐
                                   ├─ existing provider seam + capability metadata
Seller Center adapter ─────────────┘
                 ↓
canonical Orders + Finance datasets with provenance
                 ↓
PostgreSQL facts/history
                 ↓
deterministic authoritative and analytical metrics
                 ↓
revisioned effective policy: GLOBAL default + optional SHOP override
                 ↓
deterministic Rule
                 ↓
resolve requested AI task configuration/revision
                 ↓
build and validate frozen AiDecisionContext
                 ↓
build Decision Case with deterministic evidence and only non-secret
requested AI config metadata known before invocation
                 ↓
persist immutable Decision Case
                 ├─→ invoke configured AI task using persisted frozen context
                 │    ↓
                 │   persist linked AI Decision/result/runtime provenance
                 ↓
BA submits append-only revision linked to the Case
                 ↓
history/readback
```

### Immutable Case invariants

- The Case is persisted before AI invocation.
- The Case exists even when AI is disabled, unavailable, times out, or returns invalid output.
- AI reads only the frozen context associated with the persisted Case.
- BA may decide even when the linked AI Decision is unavailable, subject to existing validation.
- AI and BA never update Case facts, metrics, policy, Rule, coverage, or context.
- The Case may include only pre-invocation requested AI metadata: task ID, task-config revision, provider kind, requested model, prompt/policy/output-schema version, and a non-secret secret-reference ID when necessary.
- Actual output, reported/actual model, runtime timestamps/latency, provider response identity, rate-limit evidence, and failure provenance belong only to the linked AI Decision record.

### Capability-specific Finance provider modes

#### Current V1 mode

```text
COTIK Orders
  role = PRIMARY_NORMAL_PATH candidate when configured/bound

COTIK statements/payments
  role = SUPPLEMENTARY_FINANCE
  Official-On-Hold capability = UNPROVEN

Seller Center Finance On Hold
  role = AUTHORITATIVE_OFFICIAL_ON_HOLD
```

Configured GMT+07 checkpoints evaluate the latest authoritative Seller Center Official-OH health. If health requires refresh, the controller invokes the existing Seller Center path.

This can be implemented by a generic fallback/refresh controller, but in current V1 semantics it is an authoritative Seller Center refresh, not fallback from a proven COTIK Official-OH value.

#### Future mode, only after proof

```text
COTIK receives a verified OFFICIAL_ON_HOLD capability revision
→ COTIK may become configured normal Official-OH provider
→ stale/unavailable COTIK Official OH
→ Seller Center authoritative fallback
```

Provider selection is capability-based, so promotion requires no architecture rewrite. No current task may mark COTIK Official-OH capable.

## 18. Target End-to-End Data Flow

```text
Select canonical shop/profile
→ resolve capability-specific provider bindings
→ sync Orders through configured normal provider
→ read/refresh Official Finance through configured proven Official-OH provider
→ persist canonical facts and source/capture evidence
→ calculate authoritative and analytical metrics
→ resolve immutable effective policy revision
→ evaluate deterministic Rule with explicit Finance observation evidence
→ resolve requested AI task configuration/revision
→ build and validate frozen AiDecisionContext
→ build Decision Case with deterministic snapshots and approved non-secret
  requested AI config metadata
→ persist immutable Case
→ invoke AI using the persisted frozen context
→ persist linked AI Decision or linked unavailability record
→ present Case + AI Decision to BA
→ append BA decision/reason/notes/planned methods linked to Case
→ read back Case, AI Decision, BA revisions, and history
```

### Current authoritative refresh flow

```text
GMT+07 checkpoint or manual refresh
→ evaluate authoritative Seller Center Official-OH health
→ if fresh: skip
→ if stale/unknown/invalid and policy permits:
   deactive eligibility
   → proxy preflight
   → AdsPower session
   → normal auth recovery if needed
   → exact Shop identity proof
   → existing Seller Center Finance collector
   → exact reconciliation
   → persistence and health update
→ continue deterministic metrics/Rule/Case flow
```

## 19. Provider Architecture

Extend, do not replace, `SellerDataSource`:

- Add provider identity: `SELLER_CENTER | COTIK`.
- Add explicit capabilities such as `ORDERS`, `SUPPLEMENTARY_FINANCE`, and `OFFICIAL_ON_HOLD`.
- Keep `collectOrders()` as the shared Orders interface.
- Preserve current `collectFinancials()` as the Official-On-Hold-capable Finance contract for backward compatibility.
- Add an optional supplementary-Finance method for COTIK statements/payments.
- Generalize coverage/provenance without claiming lifetime completeness.
- Add explicit shop-provider bindings so COTIK shop IDs are never guessed from display names or substituted for canonical identity.
- Select providers per capability, not globally.
- COTIK is primary for Orders when enabled and bound.
- Seller Center remains authoritative for Official OH until a future proof revision promotes another provider.

## 20. Data Model Delta

All changes are additive. The exact Finance population schema is gated by `W0-T02` evidence.

1. `shop_provider_bindings`: canonical shop ↔ provider external shop identity, enabled capabilities, and sync checkpoints.
2. Sync/Finance evidence: provider, collected time, optional contract-proven provider-updated time, completeness, reconciliation, and health metadata.
3. **Finance current-population representation is not pre-selected.** `W0-T02` determines whether the smallest correct solution is:
   - latest successful capture/read scoping without new membership storage;
   - corrected snapshot selection;
   - capture-to-item membership;
   - immutable capture-item amount/state snapshots or row versioning;
   - dedup/upsert semantic correction;
   - another demonstrated minimal design.
4. If mutable settlement rows are referenced by membership, tests must prove whether current values can change after capture. A relation containing only `capture_id → settlement_row_id` is insufficient when historical amounts/states can be overwritten. In that case, preserve the minimum immutable capture-time values required for reconciliation and audit.
5. COTIK supplementary Finance statements/payments use separate tables and cannot populate Official OH.
6. `risk_policy_revisions`: immutable GLOBAL or SHOP revisions, thresholds, optional typed caution settings, effective/disabled times.
7. `finance_fallback_settings`, checkpoints, runs, and attempts: editable schedule, restart-safe claims, and audit.
8. AdsPower profile tag observation sufficient for `deactive` eligibility; no proxy secret values.
9. `ai_task_configs`: task/provider/base URL/model/parameters/secret reference/enabled/status, with no key value.
10. BA enum addition `SLOW_SELL`, planned-method array, and optional method notes.
11. Decision Case JSON contracts extend with effective policy, Finance evidence, Rule tri-state evidence, frozen context, and non-secret requested AI task config metadata known before invocation.
12. Actual AI output/runtime provenance remains in linked AI Decision records; BA revisions remain separate linked rows.

## 21. Finance Freshness / Authoritative Refresh State Model

### Finance Data Health

```text
FRESH | STALE | UNKNOWN | INCOMPLETE | RECONCILIATION_FAILED
```

Owned evidence:

- provider and provider capability;
- `providerUpdatedAt` only when contract-proven;
- `collectedAt`;
- age computed at evaluation/read time;
- completeness;
- reconciliation;
- Official-OH availability;
- refresh/fallback state.

`collectedAt` is never relabeled as COTIK upstream sync time. Statement/payment timestamps are not upstream-sync proof.

### Refresh/fallback run

```text
SCHEDULED
→ SKIPPED_FRESH | SKIPPED_DISABLED | SKIPPED_DEACTIVE
→ ELIGIBILITY_CHECK
→ PROXY_PREFLIGHT
→ SESSION_CHECK
→ AUTH_RECOVERY when needed
→ IDENTITY_VERIFY
→ COLLECTING
→ RECONCILING
→ SUCCEEDED
or
→ RETRY_WAIT → next bounded attempt
→ FAILED_EXHAUSTED
or
→ CREDENTIALS_REQUIRED | CHALLENGE_REQUIRED | AUTH_FAILED | PROXY_UNAVAILABLE
```

Default retry offsets are `[0, 30, 120, 300, 600]` seconds and remain configurable. Unique shop/business-date/checkpoint ownership prevents duplicate automatic runs. Manual refresh reuses the controller but can bypass schedule and automatic `deactive` exclusion.

## 22. Deterministic Rule, AI, and BA State Model

### Independent Rule conditions

Each condition resolves exactly one state:

```text
TRIGGERED | CLEAR | NOT_EVALUATED
```

#### Official Finance On Hold condition

- Fresh complete/reconciled Official OH: evaluate against effective threshold.
- Stale Official OH that was complete/reconciled when captured: **MUST evaluate** using the latest known value. Data Quality **MUST remain `STALE`**. Rule evidence includes source, capture time, evaluation time, age, completeness, reconciliation, and refresh state.
- Missing Official OH, incomplete capture, or reconciliation failure: `NOT_EVALUATED`.
- Operational Exposure and COTIK supplementary Finance are never substitutes.

#### Authoritative Delivery Rate condition

- Valid numerator/denominator under canonical data rules: evaluate against effective threshold.
- Invalid, unknown, or insufficient facts: `NOT_EVALUATED`.

#### Overall deterministic Rule

```text
if ANY condition == TRIGGERED
  → PAUSE candidate
else if ANY required condition == NOT_EVALUATED
  → INSUFFICIENT_DATA
else
  → CONTINUE
```

A missing Official OH does not suppress an independently triggered Delivery Rate condition, and vice versa.

### AI state

```text
DISABLED | UNAVAILABLE | AVAILABLE
```

Recommendation values:

```text
SCALE | CONTINUE | SLOW_SELL | WATCH | PAUSE
```

Known stale Finance may reach AI only when a real Official-OH snapshot exists and was complete/reconciled at capture. Context and output must state stale age and limitations. Model-reported confidence remains separate from deterministic Data Quality.

### BA state

BA appends a revision linked to the immutable Case:

- decision required;
- reason required;
- `OTHER` reason requires notes;
- `SLOW_SELL` requires at least one planned method;
- planned methods record intent only and execute nothing.

---

# PART D — MASTER PLAN

## 23. Workstream Dependency Graph

```text
W0 baseline/evidence
├─ W0-T01 baseline and ownership freeze
└─ W0-T02 profile 957 root-cause investigation

W11 provider/provenance contracts
→ W1 COTIK client/bindings
→ W2 COTIK Orders
→ W3 Orders analytics/Explorer

W0-T02 + W11 persistence
→ W5 Finance population/health
→ W4 COTIK supplementary Finance

W13 policy contracts/persistence
W2 canonical status → W12 authoritative metrics/Rule
W5 + W12 + W13 → target Rule/Case evidence

W5 health → W6 checkpoint settings/controller
→ W7 deactive/proxy
→ W9 auth recovery
→ W8 authoritative refresh/future fallback controller

W14 AI task registry/provider
W5 + W8 + W12 + W13 + W14
→ W15 frozen Case/context and linked AI Decision

W16-T01 BA persistence/domain
→ W16-T02A BA CLI

W12 + W13 + W5 → W17 historical snapshots

backend/domain/provider/refresh/AI/BA CLI/history
→ W18 CLI complete E2E

W15 + W16 + read contracts
→ W19 Dashboard contracts/settings
→ W3-T02 Order Explorer and W16-T02B Dashboard BA

all V1 implementation tasks
→ W20 verification/review

W10 optional Cloak research runs independently after W0-T01 and is non-gating
```

## 24. Detailed Workstreams

- **W0:** Approved baseline, contract ownership, and profile 957 evidence.
- **W1:** COTIK HTTP client and provider binding.
- **W2:** COTIK Orders ingestion.
- **W3:** Orders analytical queries and Explorer.
- **W4:** COTIK supplementary Finance.
- **W5:** Finance population semantics, provenance, and Data Health.
- **W6:** Refresh/fallback settings and restart-safe checkpoint controller.
- **W7:** `deactive` eligibility and proxy preflight.
- **W8:** Authoritative Seller Center refresh and future fallback orchestration.
- **W9:** Session/auth lifecycle and normal recovery.
- **W10:** Optional CloakBrowser research/POC.
- **W11:** Shared provider/persistence contract delta.
- **W12:** Canonical status, authoritative/analytical metrics, and target Rule.
- **W13:** Revisioned global/shop risk and caution policy.
- **W14:** AI task registry/settings/provider factory.
- **W15:** Frozen Case/context and Shop Health AI reviewer.
- **W16:** BA `SLOW_SELL`, CLI, Dashboard, and immutable history.
- **W17:** Objective trends and historical snapshots.
- **W18:** CLI complete E2E.
- **W19:** Dashboard backend/read/Settings contracts and minimal UI.
- **W20:** Tests, evals, verification, and independent review.

## 25. Detailed Tasks per Workstream

### W0-T01 — Freeze Approved Baseline and Contract Ownership

**Goal:** Create a repository-local implementation specification/ADR from this locked plan so execution agents do not reinterpret current versus target semantics.

**Current State:** The approved report and locked plan exist; repository docs conflict in places; the worktree contains unrelated WIP.

**Gap:** Execution needs one authoritative repository artifact and explicit shared-file ownership.

**Why:** Prevent semantic drift and conflicting edits to domain contracts/schema.

**Dependencies:** None.

**Verified files/modules:** `AGENTS.md`, `docs/context/v1-master-context.md`, `docs/context/current-implementation-status.md`, `README.md`, `docs/plans/**`.

**Verified symbols/contracts:** `SellerDataSource`, `DecisionCaseInputSchema`, `RISK_CONTROL_POLICY_V1`.

**Behavior to Add/Change:** Record locked Official-OH Rule semantics, Operational Exposure separation, COTIK capability limits, GMT+07, five BA decisions, immutable Case ordering, no-write scope, and task ownership. Capture current Git status without cleaning it.

**What MUST NOT Change:** Production source, database, historical evidence, or unrelated WIP.

**Data migration impact:** None.

**Tests Required:** Documentation consistency review; exact status/diff inventory; placeholder/artifact scan.

**Acceptance Criteria:** Every subsequent task cites this authority; superseded wording is explicit; no production change occurs.

**Evidence Required:** Committed spec/ADR diff, ownership matrix, and reviewer approval.

**Risk Level:** LOW.

**Parallelizable:** NO.

**Suggested Executor:** Luna.

**Independent Reviewer:** Technical Director/SOL architecture role.

**Rollback / compatibility:** Revert documentation-only change with no runtime impact.

### W0-T02 — Reproduce and Classify the Profile 957 `$0.41` Gap

**Goal:** Establish the exact cause and smallest correct fix for Official snapshot `$524.28` versus persisted aggregate `$523.87`.

**Current State:** Source collection reconciles at capture time, but current persisted aggregate/read semantics can combine a different population or value version.

**Gap:** Unknown whether the root cause is capture membership, read scoping, snapshot selection, deduplication, mutable upserted row values, versioning, or another issue.

**Why:** Finance schema/read design must not be chosen before this evidence exists.

**Dependencies:** `W0-T01`.

**Verified files/modules:** `packages/db/src/queries/finance.ts`, `packages/sync/src/index.ts`, `packages/db/src/schema.ts`.

**Verified symbols/contracts:** `getFinanceSummary`, `insertFinancialSnapshot`, `upsertSettlementBatch`, `FinanceCompletionProof`.

**Behavior to Add/Change:**

1. Reproduce the mismatch with a sanitized read-model/integration fixture representing repeated captures, snapshot deduplication, and settlement upserts.
2. Trace snapshot selection and settlement aggregation.
3. Determine whether settlement values/state can be overwritten after an earlier capture.
4. Compare candidate fixes: query scoping, snapshot selection, membership, immutable capture-item values/versioning, dedup/upsert correction, or another demonstrated option.
5. Recommend the smallest solution preserving current truth and historical audit truth.

**What MUST NOT Change:** Production schema/migrations, production DB data, collector, or reconciliation implementation.

**Data migration impact:** None in this task.

**Tests Required:**

- same statement ID with changed amount/state across captures;
- a row present in capture A but absent from capture B;
- identical snapshot hash with changed/current population possibility;
- latest successful sync versus latest stored snapshot selection;
- proof that simple row-ID membership is sufficient or insufficient.

**Acceptance Criteria:** Root cause is reproducible; the capture invariant is explicit; no schema is approved without historical-value proof.

**Evidence Required:** Failing regression/diagnostic, sanitized query evidence, and an evidence-backed decision record.

**Risk Level:** HIGH.

**Parallelizable:** NO.

**Suggested Executor:** Ox-Alpha, initial bounded evaluation only.

**Independent Reviewer:** Luna, required. Ox-Alpha is not promoted to further critical work until this review approves repo discipline, source accuracy, tests, and completion claims.

**Rollback / compatibility:** Diagnostic/tests/decision record only; no production rollback.

### W11-T01 — Extend Provider and Provenance Domain Contracts

**Goal:** Deepen the existing provider seam for multiple read providers without creating a competing abstraction.

**Current State:** `SellerDataSource` exists; coverage and Finance literals are Seller Center-specific.

**Gap:** Provider identity, capability declarations, provenance, and supplementary Finance are absent.

**Why:** COTIK must integrate without coupling downstream domain logic to its API.

**Dependencies:** `W0-T01`.

**Verified files/modules:** `packages/domain/src/contracts/source.ts`, `orders.ts`, `finance.ts`; Seller Center browser source.

**Verified symbols/contracts:** `SellerDataSource`, `SourceCoverageProofSchema`, `NormalizedOrderBatchSchema`, `NormalizedFinancialBatchSchema`.

**Behavior to Add/Change:** Add provider/capability/provenance types; optional supplementary Finance method; generalized coverage fields; backward-compatible Seller Center defaults.

**What MUST NOT Change:** Existing Seller Center collector behavior, rolling-12-month semantics, or the Official-OH meaning of current `collectFinancials()`.

**Data migration impact:** None.

**Tests Required:** Old/new contract parsing; capability misuse rejection; provider-neutral coverage.

**Acceptance Criteria:** Seller Center tests retain behavior; COTIK can implement Orders/supplementary Finance without claiming Official OH.

**Evidence Required:** Contract tests and API/interface review.

**Risk Level:** HIGH.

**Parallelizable:** YES with pure W13/W14 contract tasks under separate ownership.

**Suggested Executor:** Luna.

**Independent Reviewer:** Ox-Alpha or another interface reviewer; assignment does not imply critical-task promotion.

**Rollback / compatibility:** Preserve old fields through compatibility projection.

### W11-T02 — Add Provider Binding and Provenance Persistence

**Goal:** Persist canonical shop/provider identities and capability-specific source evidence.

**Current State:** `shops` primarily owns AdsPower/Seller Center identity.

**Gap:** No explicit COTIK binding or provider checkpoint persistence.

**Why:** External IDs must never be guessed or replace canonical identity.

**Dependencies:** `W11-T01`.

**Verified files/modules:** `packages/db/src/schema.ts`, migrations, DB index/shops queries.

**Verified symbols/contracts:** `shops`, `syncRuns`, `ShopRow`.

**Behavior to Add/Change:** Add `shop_provider_bindings`; source provider/capability/collection timestamps where required; repository methods for enabled binding/checkpoint resolution.

**What MUST NOT Change:** Existing shop/profile unique keys, active links, or live rows.

**Data migration impact:** Additive Drizzle migration. Backfill existing LIVE shops with Seller Center binding only where identity is already proven.

**Tests Required:** Migration integration, uniqueness, idempotency, capability resolution, and secret-field absence.

**Acceptance Criteria:** One canonical shop supports Seller Center and COTIK bindings; external IDs do not replace canonical/TikTok identities.

**Evidence Required:** Drizzle check, disposable DB migration results, repository tests.

**Risk Level:** HIGH.

**Parallelizable:** NO for shared schema/migration ownership.

**Suggested Executor:** Provisional Ox-Alpha only after `W0-T02` review; otherwise Luna/another proven DB executor.

**Independent Reviewer:** Separate PostgreSQL reviewer.

**Rollback / compatibility:** Disable bindings; old Seller Center path remains usable.

### W1-T01 — Implement the COTIK HTTP Client and Error Contract

**Goal:** Centralize COTIK authentication, application-status, rate-limit, retry, and validation behavior.

**Current State:** Complete local guide exists; no runtime client.

**Gap:** Typed client, Zod schemas, retry/rate behavior, and redaction.

**Why:** Every adapter must share one hard-to-misuse boundary.

**Dependencies:** `W11-T01`.

**Verified files/modules:** `docs/integrations/cotik/public-api-guide.md`; current config/logging patterns.

**Verified symbols/contracts:** `/order/list`, `/statements/`, `/payment-tiktok/`, `al-token`, `body.status`, HTTP/body 429.

**Behavior to Add/Change:** Validate envelopes; check body status under HTTP 200; handle HTTP/body 429 and `Retry-After`; GET retry 1s/2s/4s max three; one request in flight per token; typed permanent/transient failures; token redaction.

**What MUST NOT Change:** No tracking/product writes; no token in logs/errors/snapshots.

**Data migration impact:** None.

**Tests Required:** Success, business error, HTTP/body 429, malformed body, timeout/abort, retry exhaustion, redaction.

**Acceptance Criteria:** Every COTIK read uses one client and checks both transport and body semantics.

**Evidence Required:** Focused tests and security review.

**Risk Level:** MEDIUM.

**Parallelizable:** YES after provider contract.

**Suggested Executor:** Luna.

**Independent Reviewer:** Security/API reviewer.

**Rollback / compatibility:** Disable COTIK configuration; Seller Center remains operational.

### W1-T02 — Implement COTIK Shop Discovery and Binding Commands

**Goal:** Bind documented COTIK shop `_id` values to canonical shops explicitly.

**Current State:** No provider binding workflow.

**Gap:** Candidate discovery and user-confirmed bind/unbind operations.

**Why:** Shop identity must not be inferred from display names.

**Dependencies:** `W1-T01`, `W11-T02`.

**Verified files/modules:** COTIK guide `list_shop` responses; CLI shop commands.

**Verified symbols/contracts:** Provider-binding repositories from W11-T02.

**Behavior to Add/Change:** CLI list candidate COTIK shops; bind/unbind by explicit selection; reject duplicate external binding.

**What MUST NOT Change:** TikTok identity or AdsPower active link; no name-based automatic matching.

**Data migration impact:** Uses W11-T02 tables.

**Tests Required:** Ambiguous/no-match/duplicate/idempotent binding.

**Acceptance Criteria:** COTIK sync requires a valid enabled binding.

**Evidence Required:** CLI tests and persisted binding readback.

**Risk Level:** MEDIUM.

**Parallelizable:** NO relative to its dependencies.

**Suggested Executor:** Luna.

**Independent Reviewer:** Provider/integration reviewer.

**Rollback / compatibility:** Disable/remove binding revision without deleting canonical data.

### W2-T01 — Extend Canonical Status and Map COTIK Orders

**Goal:** Preserve every documented COTIK order in a canonical or explicit unknown bucket.

**Current State:** Canonical enum exists; Seller Center mapping safely handles only proven codes.

**Gap:** `UNPAID`, `ON_HOLD`, `AWAITING_COLLECTION`, and COTIK mapping.

**Why:** Status distribution and authoritative counts cannot silently lose orders.

**Dependencies:** `W1-T01`, `W11-T01`.

**Verified files/modules:** domain Orders contract, Seller Center normalizer, COTIK guide §3.

**Verified symbols/contracts:** `CanonicalOrderStatusSchema`, `normalizeOrder`.

**Behavior to Add/Change:** Add statuses additively; map COTIK `CANCELLED` to `CANCELED`; unknown to `UNKNOWN`; normalize non-PII operational fields and product/SKU summaries.

**What MUST NOT Change:** Existing Seller Center code mappings; no recipient/customer PII in AI/training or unnecessary list storage.

**Data migration impact:** PostgreSQL enum additions; existing rows unchanged.

**Tests Required:** Every documented status, unknown, missing fields, Seller Center regression, PII minimization.

**Acceptance Criteria:** Distribution totals reconcile; unknown remains explicit.

**Evidence Required:** Domain/normalizer tests and migration check.

**Risk Level:** HIGH.

**Parallelizable:** NO for shared enum ownership.

**Suggested Executor:** Provisional Ox-Alpha after promotion; otherwise Luna.

**Independent Reviewer:** Domain/privacy reviewer.

**Rollback / compatibility:** New enum values remain harmless; COTIK adapter can be disabled.

### W2-T02 — Implement COTIK Orders Pagination and Incremental Ingestion

**Goal:** Make COTIK the normal Orders path for configured/bound shops.

**Current State:** Existing DB upsert and sync boundaries are reusable.

**Gap:** COTIK adapter, `totalsize` traversal, update-time polling, and checkpoints.

**Why:** Reduce normal-path browser dependence.

**Dependencies:** `W1-T02`, `W2-T01`, `W11-T02`.

**Verified files/modules:** sync orchestrator, Orders queries, COTIK polling guide.

**Verified symbols/contracts:** `collectOrders`, `upsertOrderBatch`, `SyncRequest`.

**Behavior to Add/Change:** Initial All Available backfill pages through `totalsize`; incremental `filter11/filter12` update milliseconds with safe overlap; checkpoint advances only after complete persistence.

**What MUST NOT Change:** Seller Center Orders path; no lifetime-completeness claim.

**Data migration impact:** Provider checkpoint/source evidence from binding tables.

**Tests Required:** Multi-page, total mismatch, duplicates, overlap idempotency, crash before checkpoint, 429.

**Acceptance Criteria:** Bound shop defaults to COTIK Orders; failures preserve prior data/checkpoint.

**Evidence Required:** Adapter/sync integration tests and readback.

**Risk Level:** HIGH.

**Parallelizable:** NO relative to binding/status dependencies.

**Suggested Executor:** Luna.

**Independent Reviewer:** Integration reviewer.

**Rollback / compatibility:** Disable COTIK Orders binding; preserve imported canonical facts.

### W3-T01 — Add Orders Analytical Query and Read Contracts

**Goal:** Support Today, 7D, 30D, 12M, All Available, status/search/pagination, distribution, and detail projection.

**Current State:** DB list supports date/limit; Dashboard has aggregate health only.

**Gap:** Locked periods, coverage range, status distribution, search, and dedicated detail DTO.

**Why:** Orders are first-class V1 data, and UI filters must not affect Rule inputs.

**Dependencies:** `W2-T01`.

**Verified files/modules:** Orders queries, CLI period resolver, Dashboard contracts.

**Verified symbols/contracts:** `listOrders`, `OrderRow`.

**Behavior to Add/Change:** GMT+07 period resolver; paginated/searchable status distribution; coverage range; privacy-minimized list DTO; separate server-side Order Detail projection. Document operationally required Detail fields and apply data minimization.

**What MUST NOT Change:** Analytical filters never alter authoritative Rule; do not infer that AI privacy forbids all operational Detail fields.

**Data migration impact:** Add indexes only with query-plan evidence.

**Tests Required:** GMT+07 boundaries, US proxy/browser timezone independence, unknown bucket, All Available wording, list/detail field allowlists.

**Acceptance Criteria:** Distribution totals reconcile; Rule result remains identical across analytical filters; list remains privacy-minimized.

**Evidence Required:** Query tests and privacy contract review.

**Risk Level:** MEDIUM.

**Parallelizable:** YES after status contract.

**Suggested Executor:** Luna.

**Independent Reviewer:** Query/privacy reviewer.

**Rollback / compatibility:** Existing CLI list remains available.

### W3-T02 — Add Minimal Order Explorer UI

**Goal:** Make the Orders card clickable and operationally inspectable.

**Current State:** No explorer/detail route.

**Gap:** Filters, pagination, search, and detail presentation.

**Why:** Satisfy first-class Orders capability without final-polish scope.

**Dependencies:** `W3-T01`, `W19-T01`.

**Verified files/modules:** Dashboard Order Health component and current shops WIP.

**Verified symbols/contracts:** Versioned Dashboard/read DTOs.

**Behavior to Add/Change:** Card link to Explorer; default All Available; period/status/search/pagination; coverage labels; dedicated minimized Order Detail. Operational customer fields may be exposed only when genuinely required through the existing server-side/local access boundary and approved allowlist.

**What MUST NOT Change:** No Rule recomputation in React; no unnecessary PII in list/cache/log; no PII in AI/training/Decision Cases; no broad CRM/RBAC invention.

**Data migration impact:** None.

**Tests Required:** Routes, filters, pagination, keyboard/accessibility, list/detail allowlists, AI/training PII exclusion.

**Acceptance Criteria:** Operator can find and inspect an order. If V1 chooses non-PII-only Detail, that is documented as a deliberate V1 scope choice, not an AI-privacy consequence.

**Evidence Required:** Component/route/accessibility tests.

**Risk Level:** MEDIUM.

**Parallelizable:** YES in late UI wave.

**Suggested Executor:** Luna.

**Independent Reviewer:** UI/accessibility/privacy reviewer.

**Rollback / compatibility:** Remove route/link; backend remains.

### W5-T01 — Implement the Evidence-Selected Finance Population Fix

**Goal:** Make a current Official-OH read use exactly the population/value version that was complete and reconciled for its selected capture while preserving history.

**Current State:** Collector reconciles at capture; profile 957 proves current summary ambiguity.

**Gap:** Final persistence/read design is unknown until W0-T02.

**Why:** Downstream Rule/health must not compare an official snapshot with unrelated or mutated rows.

**Dependencies:** `W0-T02`, `W11-T02`.

**Verified files/modules:** Finance schema/query/sync modules.

**Verified symbols/contracts:** `getFinanceSummary`, `insertFinancialSnapshot`, `upsertSettlementBatch`.

**Behavior to Add/Change:** Implement only W0-T02’s selected solution: query/read scoping, snapshot correction, capture membership, immutable capture items/row versions, dedup correction, or another smaller proven fix.

**What MUST NOT Change:** Existing source reconciliation, historical settlement facts, or snapshot values. Do not introduce membership solely because it appeared as an earlier candidate.

**Data migration impact:** Conditional:

- prefer no migration if a correct query/selection fix suffices;
- if membership is required, prove mutable row references preserve capture-time values;
- otherwise store/version only the immutable capture-time fields needed for reconciliation;
- unreconstructable legacy captures remain explicitly proof-unavailable, not guessed.

**Tests Required:** W0-T02 regression, repeated captures, changed/removed rows, snapshot dedup, idempotency, historical readback.

**Acceptance Criteria:** Current Official Finance population either reconciles exactly to its selected snapshot or reports proof unavailable. The profile 957 delta is not hidden.

**Evidence Required:** Passing regression, migration/query evidence, Finance reviewer approval.

**Risk Level:** HIGH.

**Parallelizable:** NO.

**Suggested Executor:** Provisional Ox-Alpha only after W0-T02 approval; otherwise a proven DB executor.

**Independent Reviewer:** Separate Finance and PostgreSQL reviewers.

**Rollback / compatibility:** Feature-flag/projection rollback where practical; old aggregate labeled historical, not current.

### W5-T02 — Add Finance Provenance, Data Health, and Official-Provider Capability

**Goal:** Give CLI, Dashboard, Rule, AI, and BA one deterministic Finance health contract.

**Current State:** Coverage timestamps exist but lack provider/capability/refresh semantics.

**Gap:** Source, age, quality, and capability-specific availability.

**Why:** Consumers must never disagree about freshness or treat supplementary Finance as Official OH.

**Dependencies:** `W5-T01`, `W11-T01`.

**Verified files/modules:** persisted decision workflow, domain Decisions, Dashboard read model.

**Verified symbols/contracts:** `DecisionCoverageSnapshotSchema`, `assessDecisionFreshness`.

**Behavior to Add/Change:** Compute provider/capability, optional provider-updated time, collected time, age, health, completeness, reconciliation, Official-OH availability, and refresh state. Current authoritative provider is `SELLER_CENTER`; COTIK statements/payments are `SUPPLEMENTARY_FINANCE` only. Support future capability promotion through config/revision.

**What MUST NOT Change:** Never infer COTIK upstream time; do not let supplementary Finance satisfy Official-OH freshness/reconciliation.

**Data migration impact:** Additive source metadata and snapshot JSON versioning.

**Tests Required:** Collected time vs provider-updated time, stale/unknown/incomplete/reconciliation failure, legacy rows, no current COTIK Official-OH capability.

**Acceptance Criteria:** Every consumer gets the same health result. Future provider promotion needs a proof revision, not code reinterpretation.

**Evidence Required:** Domain/read tests and interface review.

**Risk Level:** HIGH.

**Parallelizable:** NO relative to Finance fix.

**Suggested Executor:** Luna or a proven domain executor.

**Independent Reviewer:** Domain/Finance reviewer.

**Rollback / compatibility:** Legacy coverage projection remains readable.

### W4-T01 — Persist COTIK Statements and Payments as Supplementary Finance

**Goal:** Keep useful COTIK Finance without semantic relabeling.

**Current State:** Guide documents statements/payments; current settlement tables mean Seller Center On Hold.

**Gap:** Typed ingestion and separate persistence.

**Why:** Add data without corrupting Official-OH semantics.

**Dependencies:** `W1-T01`, `W5-T02`, `W11-T02`.

**Verified files/modules:** COTIK guide §4; Finance domain/schema.

**Verified symbols/contracts:** New supplementary-Finance capability.

**Behavior to Add/Change:** Parse/paginate through `totalsize`; sliding date window; persist signed amounts and joins in separate tables; expose `OFFICIAL_ON_HOLD_UNPROVEN` capability status.

**What MUST NOT Change:** Do not populate `officialOnHoldAmount`, source reconciliation, freshness, or Rule input.

**Data migration impact:** Add supplementary tables, provider-ID uniqueness, and indexes.

**Tests Required:** Statement/payment joins, signed decimals, pagination, replay/idempotency, absence of Official-OH projection.

**Acceptance Criteria:** CLI/Dashboard label these datasets as COTIK statements/payments, never Official On Hold.

**Evidence Required:** Persistence/integration tests and semantic review.

**Risk Level:** HIGH.

**Parallelizable:** YES after client/health, subject to schema ownership.

**Suggested Executor:** Provisional Ox-Alpha after promotion; otherwise proven DB executor.

**Independent Reviewer:** Finance semantic reviewer.

**Rollback / compatibility:** Disable supplementary reads; tables remain historical.

### W13-T01 — Define Effective Risk and Caution Policy Contracts

**Goal:** Replace source constants with a pure, immutable effective policy resolver.

**Current State:** `RISK_CONTROL_POLICY_V1` is a source constant.

**Gap:** Global/shop revisions, partial override, caution semantics, provenance.

**Why:** BA must edit policy without code, and historical cases must retain the policy used.

**Dependencies:** `W0-T01`.

**Verified files/modules:** risk-control domain and Decision Case schemas.

**Verified symbols/contracts:** `RiskControlPolicySchema`.

**Behavior to Add/Change:** Required GLOBAL thresholds; optional partial SHOP override; caution per metric represented as disabled or discriminated absolute-buffer/relative-ratio; resolver returns values, revision IDs, source, and effective time.

**What MUST NOT Change:** Initial defaults `$3500` and `0.70`; no seller/person/BA hierarchy; no implicit caution value.

**Data migration impact:** None.

**Tests Required:** Precedence, partial override, disabled/absolute/relative caution, invalid values, prospective resolution.

**Acceptance Criteria:** Pure deterministic resolver; no AI-invented near-threshold number.

**Evidence Required:** Domain tests and business-rule review.

**Risk Level:** HIGH.

**Parallelizable:** YES under separate pure-contract ownership.

**Suggested Executor:** Provisional Ox-Alpha after promotion; otherwise Luna.

**Independent Reviewer:** Domain reviewer.

**Rollback / compatibility:** Resolver can emit existing global defaults.

### W13-T02 — Persist Policy Revisions and Settings Operations

**Goal:** Make global/shop/caution policy editable without source changes.

**Current State:** No policy settings persistence.

**Gap:** Immutable revisions, effective query, local server/CLI operations.

**Why:** New reviews must use current policy while historical cases remain unchanged.

**Dependencies:** `W13-T01`.

**Verified files/modules:** DB schema/query patterns and local request handlers.

**Verified symbols/contracts:** New policy repositories/resolver.

**Behavior to Add/Change:** Immutable GLOBAL/SHOP revisions; override deletion as a disabling revision; effective policy reads; CLI/local server create/edit/delete.

**What MUST NOT Change:** Historical Cases or prior policy rows; no direct mutation of old revisions.

**Data migration impact:** Add `risk_policy_revisions` with scope/effective constraints and indexes.

**Tests Required:** Migration, concurrency, precedence, effective time, prospective update, old Case immutability.

**Acceptance Criteria:** New reviews use latest effective policy; old Cases retain exact prior policy snapshot.

**Evidence Required:** DB integration, resolver tests, schema check.

**Risk Level:** HIGH.

**Parallelizable:** NO for migration ownership.

**Suggested Executor:** Provisional Ox-Alpha after promotion; otherwise proven DB executor.

**Independent Reviewer:** PostgreSQL/domain reviewer.

**Rollback / compatibility:** Activate a compensating/prior revision; do not mutate history.

### W12-T01 — Implement Authoritative and Analytical Delivery Rate Contracts

**Goal:** Make authoritative counts/formula explicit and independent from analytical periods.

**Current State:** Formula exists inside operational risk; presentation metrics differ.

**Gap:** Shared authoritative metric contract and locked period behavior.

**Why:** Rule, CLI, Dashboard, AI, and BA must use the same authoritative numerator/denominator.

**Dependencies:** `W2-T01`.

**Verified files/modules:** risk-control domain, metrics calculator, DB risk facts.

**Verified symbols/contracts:** Existing status sets and `evaluateRiskControlFacts`.

**Behavior to Add/Change:** Pure authoritative metric returns delivered count, total count, rate, and data issues. Total includes awaiting shipment and awaiting collection; delivered includes in transit, delivered, completed. Analytical calculator uses separate GMT+07 periods.

**What MUST NOT Change:** Unknown fail-closed; filter changes never alter authoritative metric.

**Data migration impact:** None.

**Tests Required:** Exact status sets, zero denominator, unknown, sample size, Today/7D/30D/12M/All Available, timezone independence.

**Acceptance Criteria:** CLI/Dashboard display rate plus delivered/total; Rule consumes only authoritative result.

**Evidence Required:** Domain tests and formula review.

**Risk Level:** HIGH.

**Parallelizable:** YES after status contract with non-overlapping ownership.

**Suggested Executor:** Luna.

**Independent Reviewer:** Domain/business reviewer.

**Rollback / compatibility:** Existing risk formula remains available until versioned cutover.

### W12-T02 — Add the Versioned Official-OH Shop Health Rule

**Goal:** Apply the locked target Rule to new reviews while preserving historical operational Rule snapshots.

**Current State:** Current evaluator thresholds Operational Exposure and carries Holiday Mode terminology.

**Gap:** Official-OH condition, condition tri-state, stale-value evidence, and caller migration.

**Why:** Locked V1 business semantics require Official OH plus authoritative Delivery Rate.

**Dependencies:** `W5-T02`, `W12-T01`, `W13-T01`.

**Verified files/modules:** risk-control domain, sync evaluator, decision workflow.

**Verified symbols/contracts:** `mapRiskResultToRuleDecision`, Decision Rule schemas.

**Behavior to Add/Change:**

- Evaluate Rule before Case creation; freeze Rule evidence into the Case.
- Each condition resolves `TRIGGERED | CLEAR | NOT_EVALUATED`.
- Fresh complete/reconciled Official OH evaluates normally.
- Stale but complete/reconciled-at-capture Official OH **must** evaluate using latest known value while Data Quality remains `STALE`.
- Missing/incomplete/reconciliation-failed Official OH yields `NOT_EVALUATED`.
- Authoritative Delivery Rate independently resolves its tri-state.
- Overall: any triggered → PAUSE candidate; otherwise any required not evaluated → insufficient; otherwise continue.
- Operational Exposure remains context-only.

**What MUST NOT Change:** Historical Rule snapshots/evaluator; no automatic pause; no COTIK supplementary substitution.

**Data migration impact:** Extend trigger/check enums/contracts additively; old values remain parseable.

**Tests Required:**

1. Fresh Official OH below/at/above threshold.
2. Stale valid-at-capture Official OH must evaluate and preserve stale Data Quality.
3. Stale OH triggered + Delivery Rate unavailable → PAUSE candidate.
4. Missing OH + Delivery Rate triggered → PAUSE candidate.
5. Missing OH + Delivery Rate clear → insufficient.
6. Incomplete OH + Delivery Rate triggered → PAUSE candidate.
7. Reconciliation-failed OH + Delivery Rate clear → insufficient.
8. OH clear + Delivery Rate triggered → PAUSE candidate.
9. OH triggered + Delivery Rate clear/unavailable → PAUSE candidate.
10. Both clear → continue.
11. Both not evaluated → insufficient.
12. COTIK supplementary Finance and Operational Exposure cannot satisfy OH check.
13. Analytical periods do not alter Rule.
14. Rule evidence is immutable in Case.
15. Rule evaluation produces no execution record.

**Acceptance Criteria:** Every new Case contains target Rule evidence with source/observation/age/quality. A stale Rule result cannot serialize as fresh.

**Evidence Required:** Domain/integration tests and independent business-rule review.

**Risk Level:** HIGH.

**Parallelizable:** NO.

**Suggested Executor:** Provisional Ox-Alpha after promotion; otherwise proven domain executor.

**Independent Reviewer:** Luna/business-rule reviewer.

**Rollback / compatibility:** Versioned evaluator permits emergency legacy selection without mutating Cases.

### W6-T01 — Persist Refresh/Fallback Settings and Checkpoints

**Goal:** Make schedule/retries functional and editable.

**Current State:** Worker uses elapsed interval env values.

**Gap:** Global ON/OFF, checkpoint CRUD, custom times, retry policy.

**Why:** Upstream schedules may change without code changes.

**Dependencies:** `W5-T02`.

**Verified files/modules:** Worker config/loop and DB setting patterns.

**Verified symbols/contracts:** New settings/checkpoint repositories.

**Behavior to Add/Change:** Global auto-refresh ON/OFF; checkpoint add/edit/delete/enable; custom `HH:mm`; GMT+07 semantics; retry offsets default 0/30/120/300/600.

**What MUST NOT Change:** `08:00/11:00/17:00` are seed defaults only, never immutable constants or stale ages.

**Data migration impact:** Add settings/checkpoint tables with time/uniqueness checks.

**Tests Required:** Arbitrary combinations, CRUD persistence, GMT+07 parsing, invalid duplicates/time, retry customization.

**Acceptance Criteria:** Schedule changes apply without source edits or required restart.

**Evidence Required:** DB/settings tests and schema validation.

**Risk Level:** MEDIUM.

**Parallelizable:** YES after Finance health, subject to migration ownership.

**Suggested Executor:** Luna.

**Independent Reviewer:** Scheduler/DB reviewer.

**Rollback / compatibility:** Set Auto Refresh OFF; manual refresh remains.

### W6-T02 — Implement Restart-Safe Checkpoint and Attempt Controller

**Goal:** Execute bounded retries without an external queue or in-memory-only state.

**Current State:** No checkpoint run state.

**Gap:** Durable claim, attempts, next-attempt time, duplicate prevention, daily progression.

**Why:** Worker restart/concurrency must not duplicate browser work or lose retry state.

**Dependencies:** `W6-T01`.

**Verified files/modules:** Worker loop, sync-run locks/repositories.

**Verified symbols/contracts:** Advisory locks and new run/attempt repositories.

**Behavior to Add/Change:** Claim due checkpoints; unique shop/business-date/checkpoint run; persist attempt number/nextAttemptAt; success closes stale cycle; later checkpoints reevaluate health; exhaustion waits next checkpoint/day.

**What MUST NOT Change:** No parallel AdsPower profiles; no infinite retry; no sole reliance on long sleeps.

**Data migration impact:** Add run/attempt tables and indexes.

**Tests Required:** Fake clock, restart between attempts, duplicate workers, next checkpoint/day, success then skip/recheck, Auto OFF.

**Acceptance Criteria:** Exactly bounded attempts and durable audit.

**Evidence Required:** Unit/concurrency/DB integration tests.

**Risk Level:** HIGH.

**Parallelizable:** NO.

**Suggested Executor:** Provisional Ox-Alpha after promotion; otherwise proven concurrency executor.

**Independent Reviewer:** Luna/concurrency reviewer.

**Rollback / compatibility:** Auto OFF stops claims; records remain for audit.

### W7-T01 — Add `deactive` Eligibility and Verify Proxy Capability

**Goal:** Enforce business exclusion before automatic refresh and determine a safe proxy input seam.

**Current State:** Tags are readable but not used; proxy details are intentionally stripped.

**Gap:** Persisted/observed tag eligibility and server-side proxy capability evidence.

**Why:** Deactive profiles must avoid routine fallback and proxy retries.

**Dependencies:** `W6-T02`, `W11-T02`.

**Verified files/modules:** AdsPower profile client/schema and profile queue.

**Verified symbols/contracts:** `AdsPowerProfileSummary.tags`, eligible-shop query.

**Behavior to Add/Change:** Normalize tag names case-insensitively; persist tag observation; automatic eligibility returns `SKIPPED_DEACTIVE`; manual action remains. Probe documented AdsPower server-side proxy/test capability without exposing values.

**What MUST NOT Change:** `deactive` never means proxy dead/expired; no tag mutation.

**Data migration impact:** Add minimal tag snapshot/observedAt metadata.

**Tests Required:** Tag casing/combinations, stale inventory, manual override, secret-redaction capability report.

**Acceptance Criteria:** Automatic refresh/proxy retry does not run for proven deactive profile.

**Evidence Required:** Policy tests and security review.

**Risk Level:** MEDIUM.

**Parallelizable:** NO relative to controller/provider state.

**Suggested Executor:** Luna.

**Independent Reviewer:** Policy/security reviewer.

**Rollback / compatibility:** Auto OFF/manual path remain.

### W7-T02 — Implement Observable Proxy Preflight

**Goal:** Classify observable proxy health before browser work without inventing expiry.

**Current State:** Browser-level `PROXY_TIMEOUT` detection exists.

**Gap:** Preflight adapter and explicit observable states.

**Why:** Avoid unnecessary browser starts and classify transient failures honestly.

**Dependencies:** `W7-T01`.

**Verified files/modules:** Seller Center error taxonomy and Dashboard operation mapping.

**Verified symbols/contracts:** `SellerCenterFailureType`, `SourceHealthSchema`.

**Behavior to Add/Change:** Server-only adapter returns `HEALTHY | DEGRADED | UNAVAILABLE | UNKNOWN`, latency, and optional exit IP; bounded timeout; redacted reason class. If safe material is unavailable, return `UNKNOWN`.

**What MUST NOT Change:** Never return `PROXY_EXPIRED`; no plaintext credentials.

**Data migration impact:** Store only result metadata with refresh attempts.

**Tests Required:** Auth failure, timeout, outage, slow/degraded, unknown, secret redaction.

**Acceptance Criteria:** Orchestrator proceeds/retries according to observable state and logs no secret.

**Evidence Required:** Adapter tests and security/network review.

**Risk Level:** HIGH.

**Parallelizable:** NO.

**Suggested Executor:** Provisional Ox-Alpha after promotion; otherwise proven security/network executor.

**Independent Reviewer:** Luna/security reviewer.

**Rollback / compatibility:** Adapter may return UNKNOWN; browser timeout remains secondary evidence.

### W9-T01 — Extend Auth/Session State and Credential-Reference Seam

**Goal:** Model normal login recovery safely before automating it.

**Current State:** Login/challenge detection exists; credential capability does not.

**Gap:** Typed credentials-required/auth-failed states and server-side capability interface.

**Why:** Logged-out flows need actionable, bounded outcomes.

**Dependencies:** `W7-T02`.

**Verified files/modules:** Browser source, error taxonomy, profile verification schemas.

**Verified symbols/contracts:** `LOGIN_REQUIRED`, `CHALLENGE_REQUIRED`, `ProfileVerificationStateSchema`.

**Behavior to Add/Change:** Add `CREDENTIALS_REQUIRED`/`AUTH_FAILED` equivalents while preserving legacy mappings; server-only credential capability initially supports safe AdsPower autofill/reference and never secret extraction.

**What MUST NOT Change:** No CAPTCHA bypass, cookies/session export, DB plaintext credential, AI prompt credential, or log secret.

**Data migration impact:** Enum additions and optional non-secret reference metadata.

**Tests Required:** Legacy parsing, missing credentials, challenge precedence, secret absence.

**Acceptance Criteria:** Every logged-out path ends in an actionable typed state.

**Evidence Required:** Domain/browser tests and security review.

**Risk Level:** HIGH.

**Parallelizable:** NO.

**Suggested Executor:** Luna or a proven auth executor.

**Independent Reviewer:** Independent auth/security reviewer.

**Rollback / compatibility:** Map new states to existing LOGIN/HUMAN_ACTION UI while retaining stored detail.

### W9-T02 — Implement Session Recovery Completion and Post-Login Identity Proof

**Goal:** Safely resume collection from an existing authenticated session or operator-completed manual bootstrap, always with post-login identity proof; perform normal auto-login only when a verified safe autofill capability exists.

**Current State:** Detection, typed unavailable/manual states, canonical verification, and authenticated-session collection paths exist; no verified safe AdsPower autofill action contract exists.

**Gap:** Explicitly prove the manual-bootstrap rerun-verification completion path and preserve the optional bounded auto-login boundary for a future verified capability.

**Why:** V1 must recover safely without inventing credential automation or trusting a human login completion without canonical identity evidence.

**Dependencies:** `W9-T01`.

**Verified files/modules:** Seller Center browser-source lifecycle and verification tests.

**Verified symbols/contracts:** `verifyProfile`, seller-access classification.

**Behavior to Add/Change:** Accept an existing authenticated session. On login-required, persist actionable `CREDENTIALS_REQUIRED` when no verified capability exists; on challenge, persist `HUMAN_ACTION_REQUIRED`. An operator may complete ordinary login outside Tool_TTS, then rerun canonical profile verification. Collection may begin only after that rerun proves the exact linked TikTok Shop identity. If a verified safe autofill capability is later available, a canonical adapter may make one bounded normal attempt, wait for an authenticated route, classify success/challenge/failure, and perform the same identity re-proof.

**What MUST NOT Change:** No infinite loop, CAPTCHA handling/bypass, credential reading/injection/logging, selector guessing, trust in manual completion without canonical re-proof, or identity guessing.

**Data migration impact:** Attempt outcome stored in refresh audit only.

**Tests Required:** Existing authenticated session, manual bootstrap followed by verified exact identity, missing credential, challenge, identity mismatch, and collection refusal before/re-proof failure. Add autofill success/wrong-credential tests only when a verified real autofill capability is introduced.

**Acceptance Criteria:** An existing authenticated session and operator-completed manual bootstrap both permit collection only after successful canonical exact-identity re-proof. Missing credential fails closed; challenge becomes `HUMAN_ACTION_REQUIRED`. Safe autofill auto-login is optional and cannot block V1 without a verified capability contract.

**Evidence Required:** Mocked verification/sync tests for authenticated and manual-bootstrap paths; LIVE evidence for the manual path when environment allows. Any future autofill path requires separate mocked and LIVE capability evidence.

**Risk Level:** HIGH.

**Parallelizable:** NO.

**Suggested Executor:** Provisional Ox-Alpha only after promotion; otherwise proven Playwright/auth executor.

**Independent Reviewer:** Luna/Playwright security reviewer.

**Rollback / compatibility:** Retain manual bootstrap state and canonical re-verification; disable any future auto-login adapter independently.

### W8-T01 — Compose Authoritative Official-Finance Refresh and Future Fallback Controller

**Goal:** Reuse all proven modules in one capability-aware, reversible controller.

**Current State:** Health, AdsPower, identity, collector, and reconciliation pieces exist independently.

**Gap:** Current authoritative refresh orchestration and future capability-based fallback order.

**Why:** Checkpoints/manual refresh need one audited path.

**Dependencies:** `W5-T02`, `W6-T02`, `W7-T02`, `W9-T02`.

**Verified files/modules:** sync orchestrator, profile orchestration, Dashboard runtime.

**Verified symbols/contracts:** `runShopSync`, `FinanceCompletionProof`, profile locks.

**Behavior to Add/Change:** Health check → eligibility → proxy → AdsPower → existing authenticated session or typed manual-bootstrap/auth state → canonical identity re-proof → existing collector → reconciliation → health update. Manual CLI/server operation invokes the same controller. Current mode records `authoritativeProvider=SELLER_CENTER`. Future provider order is selected only through proven capabilities/config.

**What MUST NOT Change:** Existing collector internals, profile concurrency=1, `deactive` automatic exclusion, stale snapshot retention, or COTIK supplementary semantics.

**Data migration impact:** Uses refresh/fallback audit tables.

**Tests Required:** Fresh skip, stale trigger, Auto OFF, manual refresh, manual-bootstrap re-verification, five attempts, next checkpoint, deactive, proxy, auth/challenge, reconciliation fail closed, current/future provider capability selection.

**Acceptance Criteria:** Success updates authoritative Official-OH health; failure preserves prior snapshot with warning/reason; no business action follows refresh.

**Evidence Required:** Controller integration tests and LIVE evidence when available.

**Risk Level:** HIGH.

**Parallelizable:** NO.

**Suggested Executor:** Luna or a proven orchestration executor.

**Independent Reviewer:** Independent E2E/state-machine reviewer.

**Rollback / compatibility:** Auto OFF; direct manual Finance sync remains.

### W10-T01 — Optional CloakBrowser Isolated POC Decision Record

**Goal:** Resolve the candidate boundary without coupling production V1.

**Current State:** AdsPower owns the current browser binary/profile; CloakBrowser launches its own patched Chromium runtime.

**Gap:** Evidence whether a future self-managed session path offers value.

**Why:** Avoid assuming Playwright attachment transforms an AdsPower browser into CloakBrowser.

**Dependencies:** `W0-T01` only.

**Verified files/modules:** Current AdsPower CDP source and official CloakBrowser repository documentation.

**Verified symbols/contracts:** `chromium.connectOverCDP`, `AdsPowerBrowserConnection`.

**Behavior to Add/Change:** Isolated sanitized POC compares self-managed Cloak session/profile lifecycle with AdsPower. Produce an ADR recommendation.

**What MUST NOT Change:** No production dependency, profile migration, CAPTCHA/security bypass claim, or V1 gate.

**Data migration impact:** None.

**Tests Required:** Reproducible launch/CDP/session notes, platform/license/security review.

**Acceptance Criteria:** Result is `DEFER` unless a self-managed path proves concrete benefit and acceptable migration cost. Incomplete/failing research does not affect V1 readiness.

**Evidence Required:** Optional POC/ADR when available.

**Risk Level:** MEDIUM.

**Parallelizable:** YES; independent and non-gating.

**Suggested Executor:** Ox-Alpha research executor only after evaluation, or another research agent.

**Independent Reviewer:** Security/architecture reviewer.

**Rollback / compatibility:** Delete isolated POC artifacts; production untouched.

### W14-T01 — Persist AI Task Registry Metadata and Secret References

**Goal:** Configure AI by task without hard-coded provider/model.

**Current State:** One env-only 9Router baseline.

**Gap:** Task IDs, revisioned metadata, secret references, and status.

**Why:** V1 must configure `SHOP_HEALTH_REVIEWER` and prepare disabled future slots.

**Dependencies:** `W0-T01`.

**Verified files/modules:** Decision AI config/registry and `.env.example`.

**Verified symbols/contracts:** `BaselineAiConfig`, `ToolAiModelRegistry`.

**Behavior to Add/Change:** Task IDs including enabled `SHOP_HEALTH_REVIEWER` and disabled future tasks; provider kind, base URL, model, parameters, secretRef, enabled/status; compatibility seed from current env.

**What MUST NOT Change:** No API key in DB/browser/log; no local inference engine requirement.

**Data migration impact:** Add revisioned/current `ai_task_configs` metadata storage.

**Tests Required:** Secret absence, invalid URL/parameters, disabled/unset task, env compatibility.

**Acceptance Criteria:** User changes Shop Health model/provider without source edits.

**Evidence Required:** DB/config tests and security review.

**Risk Level:** HIGH.

**Parallelizable:** YES under isolated ownership.

**Suggested Executor:** Provisional Ox-Alpha after promotion; otherwise proven DB/config executor.

**Independent Reviewer:** Luna/security reviewer.

**Rollback / compatibility:** Resolve existing env config when no persisted task exists.

### W14-T02 — Add AI Provider Factory and Server-Side Test Connection

**Goal:** Support current 9Router and future configured OpenAI-compatible/HF-hosted endpoints through one task interface.

**Current State:** Concrete 9Router provider exists.

**Gap:** Provider factory, task resolver, sanitized connection test.

**Why:** Multi-task settings must not fork AI workflow logic.

**Dependencies:** `W14-T01`.

**Verified files/modules:** NineRouter provider and AI client.

**Verified symbols/contracts:** `BaselineAiClient`.

**Behavior to Add/Change:** Provider factory; OpenAI-compatible adapter first; optional HF adapter only with explicit contract; sanitized Test Connection without business/PII payload.

**What MUST NOT Change:** Existing structured validation, provenance, fail-closed behavior, or secret boundaries.

**Data migration impact:** Update only non-secret connection-status metadata.

**Tests Required:** Success, auth failure, rate limit, timeout, malformed output, redaction, requested/reported identity.

**Acceptance Criteria:** Server-safe typed connection result; key never echoed.

**Evidence Required:** Provider tests and API/security review.

**Risk Level:** HIGH.

**Parallelizable:** NO relative to registry.

**Suggested Executor:** Luna.

**Independent Reviewer:** API/security reviewer.

**Rollback / compatibility:** Keep 9Router adapter selected.

### W15-T01 — Resolve AI Config, Freeze/Persist Case, Then Invoke AI

**Goal:** Preserve immutable Case ordering while extending context for policy, stale Finance, refresh evidence, and requested AI metadata.

**Current State:** Frozen context validation and linked AI persistence exist.

**Gap:** Target Rule/policy/health context, requested task revision ordering, and stale advisory handling.

**Why:** AI and BA must never mutate deterministic Case evidence.

**Dependencies:** `W5-T02`, `W8-T01`, `W12-T02`, `W13-T02`, `W14-T02`.

**Verified files/modules:** frozen context, decision intelligence, AI client/prompt, workflow persistence.

**Verified symbols/contracts:** `AiDecisionContextSchema`, `validateFrozenDecisionContext`, `buildDecisionIntelligence`.

**Behavior to Add/Change:**

1. Load canonical facts and Finance health.
2. Resolve effective policy.
3. Compute metrics and deterministic Rule.
4. Resolve requested `SHOP_HEALTH_REVIEWER` task config/revision without provider invocation.
5. Build/validate frozen `AiDecisionContext`.
6. Build Case with deterministic snapshots and approved non-secret requested config metadata.
7. Persist immutable Case.
8. Read/use persisted frozen context to invoke AI.
9. Persist linked AI Decision or linked unavailability record.
10. Prove Case remains unchanged after AI and BA.

Permit AI invocation from a known stale Official-OH snapshot only when complete/reconciled at capture; include stale limitation. Missing/invalid Official OH remains unavailable as defined by Rule/context contracts.

**What MUST NOT Change:** AI must not update Case; actual result/provenance must not be backfilled; no PII/secrets; no fact recomputation.

**Data migration impact:** New Case/context schema version with backward-compatible legacy readers.

**Tests Required:** AI disabled/timeout/invalid still leaves valid Case; mutation fails; linked Decision references exact Case; requested metadata differs cleanly from actual provenance; stale context cannot appear fresh; privacy scan.

**Acceptance Criteria:** Case is queryable before AI starts and semantically identical after AI/BA operations.

**Evidence Required:** Workflow/DB integration tests and immutable-case review.

**Risk Level:** HIGH.

**Parallelizable:** NO.

**Suggested Executor:** Provisional Ox-Alpha after promotion; otherwise proven workflow/domain executor.

**Independent Reviewer:** Luna/AI-domain reviewer.

**Rollback / compatibility:** Retain prior context reader and strict-fresh AI option where needed.

### W15-T02 — Upgrade Shop Health Reviewer Output and Explanation

**Goal:** Produce BA-usable, evidence-grounded advice for all five recommendations.

**Current State:** Structured output exists but is concise and four-decision-based.

**Gap:** `SLOW_SELL`, richer evidence, stale disclosure, confidence/quality presentation.

**Why:** BA needs actual values, supporting/contradicting evidence, and limitations.

**Dependencies:** `W15-T01`, `W16-T01`.

**Verified files/modules:** AI contracts/prompt/provider/persistence.

**Verified symbols/contracts:** `BaselineAiOutputSchema`, `buildDecisionAiMessages`.

**Behavior to Add/Change:** Five recommendations; actual values/differences/counts; support/contradiction; Rule agreement/disagreement; stale capture time/age disclosure; model-reported confidence; deterministic Data Quality separate. Persist output only as linked AI Decision.

**What MUST NOT Change:** AI advisory only; no chain-of-thought, fact mutation, confidence calibration claim, or action execution.

**Data migration impact:** Additive AI persistence/read DTOs; old outputs remain readable.

**Tests Required:** Numeric grounding, Rule disagreement, stale statement, confidence label, quality separation, malformed response, privacy/secrets.

**Acceptance Criteria:** CLI/Dashboard render required fields without parsing prose; stale conclusion explicitly says stale.

**Evidence Required:** AI contract/prompt tests and independent safety review.

**Risk Level:** HIGH.

**Parallelizable:** NO relative to context and decision enum.

**Suggested Executor:** Luna.

**Independent Reviewer:** AI safety/business reviewer.

**Rollback / compatibility:** Old linked AI records remain readable.

### W16-T01 — Add `SLOW_SELL` and Planned-Method Persistence

**Goal:** Complete the locked BA decision space.

**Current State:** Four-value enum; append-only BA history works.

**Gap:** `SLOW_SELL`, planned methods, and validation.

**Why:** `SLOW_SELL` is a first-class V1 decision distinct from `WATCH`.

**Dependencies:** `W0-T01`.

**Verified files/modules:** domain Decisions, DB schema/queries/migrations.

**Verified symbols/contracts:** `BaDecisionSchema`, `BaDecisionInputSchema`, `baDecisionEnum`, `recordBaDecisionForCase`.

**Behavior to Add/Change:** Add `SLOW_SELL`; methods `DISABLE_FLASH_SALE | INCREASE_PRICE | OTHER`; allow multiple; require at least one method for SLOW_SELL; method OTHER requires notes; execute nothing.

**What MUST NOT Change:** Existing decisions/history IDs, OTHER reason-note rule, or DRY_RUN/no-action boundary.

**Data migration impact:** PostgreSQL enum addition and nullable JSON method fields; old rows valid.

**Tests Required:** Five decisions, method validation, append-only revisions, no execution.

**Acceptance Criteria:** SLOW_SELL round-trips domain/DB/read model and triggers no Seller Center call.

**Evidence Required:** Domain/DB integration and schema check.

**Risk Level:** HIGH.

**Parallelizable:** YES only under isolated contract/schema ownership.

**Suggested Executor:** Provisional Ox-Alpha after promotion; otherwise proven DB/domain executor.

**Independent Reviewer:** Luna/DB-domain reviewer.

**Rollback / compatibility:** Existing four values remain valid; UI may hide new option only during emergency rollback.

### W16-T02A — Extend BA CLI Submission and History

**Goal:** Complete the BA workflow in the CLI before Dashboard completion.

**Current State:** CLI supports four decisions and append-only history.

**Gap:** SLOW_SELL methods and immutable linked readback.

**Why:** CLI-first V1 proof must not wait for Dashboard UI.

**Dependencies:** `W16-T01`.

**Verified files/modules:** CLI review command/presentation and persisted workflow.

**Verified symbols/contracts:** `BaDecisionInputSchema`, `DecisionWorkflow`.

**Behavior to Add/Change:** CLI inputs for SLOW_SELL/planned methods; validation; current/history rendering; append BA revision by persisted Case ID.

**What MUST NOT Change:** Do not reconstruct/replace/mutate Case; no Dashboard dependency; no planned action execution.

**Data migration impact:** None beyond W16-T01.

**Tests Required:** CLI parsing/submission, OTHER notes, multiple methods, repeated revisions, Case unchanged.

**Acceptance Criteria:** CLI submits/reads all five decisions and immutable history independently of Dashboard.

**Evidence Required:** CLI tests and persisted readback.

**Risk Level:** MEDIUM.

**Parallelizable:** YES after W16-T01.

**Suggested Executor:** Luna.

**Independent Reviewer:** CLI/business reviewer.

**Rollback / compatibility:** Existing CLI options remain compatible.

### W16-T02B — Extend BA Dashboard Submission and History

**Goal:** Expose the five-decision append-only BA workflow in Dashboard.

**Current State:** Dashboard BA handler/form supports four decisions.

**Gap:** SLOW_SELL methods, DTOs, validation, and history display.

**Why:** Complete minimal BA UI after backend/read contracts are stable.

**Dependencies:** `W16-T01`, `W19-T01`.

**Verified files/modules:** Dashboard BA handler/form/read DTO.

**Verified symbols/contracts:** `createBaDecisionHandler`, Dashboard decision DTOs.

**Behavior to Add/Change:** Multi-select planned methods; validation; history rendering; append by persisted Case ID.

**What MUST NOT Change:** No deterministic recomputation, Case mutation, or business execution.

**Data migration impact:** None beyond W16-T01.

**Tests Required:** Route/form/accessibility, OTHER notes, append-only revisions, Case unchanged.

**Acceptance Criteria:** Dashboard submits and reads SLOW_SELL intent without action.

**Evidence Required:** Handler/component/read-model tests.

**Risk Level:** MEDIUM.

**Parallelizable:** YES in late UI wave.

**Suggested Executor:** Luna.

**Independent Reviewer:** UX/business reviewer.

**Rollback / compatibility:** Existing BA routes remain compatible.

### W17-T01 — Persist Objective Shop-Health Snapshots and Analytical Trends

**Goal:** Build V1 historical/future-learning data without invented labels.

**Current State:** KPI and Decision snapshots exist, but periods/cadence are fragmented.

**Gap:** Unified objective period history and policy/provenance references.

**Why:** New reviews and future learning need objective changes and exact historical context.

**Dependencies:** `W5-T02`, `W12-T01`, `W12-T02`, `W13-T02`.

**Verified files/modules:** KPI schema, metrics calculator, decision intelligence.

**Verified symbols/contracts:** `kpiSnapshots`, `MetricComparisonSchema`, `TrendPolicySchema`.

**Behavior to Add/Change:** Persist authoritative facts and Today/7D/30D/12M/All Available analytical values/deltas; categorical trends only under configured policy; include provider/policy provenance.

**What MUST NOT Change:** No GOOD/BAD label without policy; no raw PII duplication.

**Data migration impact:** Add provenance fields or focused snapshot table only if existing KPI schema cannot own it cleanly.

**Tests Required:** Cadence idempotency, GMT+07 boundaries, policy-unconfigured state, history immutability.

**Acceptance Criteria:** Review references exact historical evidence and policy revision.

**Evidence Required:** Domain/DB integration and data-minimization review.

**Risk Level:** MEDIUM.

**Parallelizable:** NO if schema changes.

**Suggested Executor:** Provisional Ox-Alpha after promotion; otherwise proven analytics executor.

**Independent Reviewer:** Luna/analytics reviewer.

**Rollback / compatibility:** Decision Cases remain sufficient audit history.

### W18-T01 — Add CLI-First Complete V1 Orchestration and Proof

**Goal:** Prove the full V1 behavior through CLI before Dashboard/minimal UI completion.

**Current State:** Individual commands exist.

**Gap:** Provider binding/sync, settings, health/refresh, AI task, BA, and immutable readback in one documented journey.

**Why:** Backend-first/CLI-first is the locked delivery priority.

**Dependencies:** `W2-T02`, `W8-T01`, `W12-T02`, `W14-T02`, `W15-T02`, `W16-T02A`, `W17-T01`.

**Verified files/modules:** CLI main/commands and persisted workflow.

**Verified symbols/contracts:** `DecisionWorkflow`, provider sync, refresh controller.

**Behavior to Add/Change:** Commands/journey for provider binding, sync, health, policy/settings, manual refresh, AI test, review, BA decision, and immutable readback; stable JSON schemas.

**What MUST NOT Change:** No Dashboard dependency, silent mock fallback, or breaking existing documented commands without compatibility.

**Data migration impact:** None beyond dependencies.

**Tests Required:** Composed fake-adapter E2E, PostgreSQL integration, tri-state Rule cases, stale Finance, refresh failures, AI unavailable, SLOW_SELL, history.

**Acceptance Criteria:** One CLI journey covers select → sync → Finance health/refresh → metrics → effective policy → Rule → immutable Case → linked AI → BA revision → history.

**Evidence Required:** Command transcript, stable JSON fixtures, integration test results.

**Risk Level:** MEDIUM.

**Parallelizable:** YES with Dashboard work once all own dependencies are ready.

**Suggested Executor:** Luna.

**Independent Reviewer:** CLI/E2E reviewer.

**Rollback / compatibility:** New commands removable; existing commands remain.

### W19-T01 — Version Dashboard Backend/Read Contracts and Clarify Timebases

**Goal:** Prepare correct Dashboard contracts without moving business logic into UI.

**Current State:** Dashboard composes current facts and latest Case/AI/BA data.

**Gap:** Ownership/timebase/source labels and new policy/health/Rule/AI/BA DTOs.

**Why:** Current facts, immutable Case, linked AI Decision, and BA revisions must not be visually conflated.

**Dependencies:** `W3-T01`, `W5-T02`, `W12-T02`, `W15-T02`, `W16-T01`.

**Verified files/modules:** Dashboard contract/read/model and operations-console WIP.

**Verified symbols/contracts:** `DashboardSource`, `DashboardDecisionCenter`, `loadDashboardPresentation`.

**Behavior to Add/Change:** Versioned sections for current operational facts versus immutable review snapshot; source/age/GMT+07/coverage; delivered/total; effective policy; Rule tri-state; deterministic Data Quality; model-reported confidence; separate linked AI Decision and BA history ownership.

**What MUST NOT Change:** No metric/Rule calculation in React; no secret/PII DTO; no Case mutation.

**Data migration impact:** None.

**Tests Required:** Current/snapshot mismatch, profile 957 warning, stale Rule, linked AI/BA ownership, unavailable data.

**Acceptance Criteria:** Every value identifies source/record owner/observation time; Rule inputs come from immutable Case.

**Evidence Required:** Read-model/contract tests and UI-contract review.

**Risk Level:** HIGH.

**Parallelizable:** YES with CLI E2E when dependencies permit.

**Suggested Executor:** Provisional Ox-Alpha only after promotion; otherwise proven contract executor.

**Independent Reviewer:** Luna/UI-contract reviewer.

**Rollback / compatibility:** Compatibility adapter supplies existing presentation shape.

### W19-T02 — Add Minimal Functional Settings UI

**Goal:** Make locked V1 settings editable without UI-polish scope.

**Current State:** No settings pages.

**Gap:** Forms/routes for policy, checkpoints/retries, and AI tasks.

**Why:** Users must change behavior without source edits.

**Dependencies:** `W6-T01`, `W13-T02`, `W14-T02`, `W19-T01`.

**Verified files/modules:** Next local handlers, shell navigation, shops WIP.

**Verified symbols/contracts:** Server-side settings repositories/DTOs.

**Behavior to Add/Change:** Settings entry/forms for global policy, shop overrides/effective policy, caution, Auto Refresh/checkpoints/retries, AI tasks/Test Connection; secret values never returned.

**What MUST NOT Change:** No broad auth-system invention; no plaintext secret display; no historical revision mutation.

**Data migration impact:** None beyond settings tables.

**Tests Required:** Route validation, secret masking, prospective policy effect, GMT+07 copy, keyboard/accessibility.

**Acceptance Criteria:** User edits settings and sees effective values without source changes.

**Evidence Required:** Handler/component tests and security/accessibility review.

**Risk Level:** MEDIUM.

**Parallelizable:** YES in late UI wave.

**Suggested Executor:** Luna.

**Independent Reviewer:** UX/security reviewer.

**Rollback / compatibility:** CLI settings remain functional.

### W20-T01 — Run Deterministic Verification, Privacy/Security Evals, and Independent Review

**Goal:** Gate V1 readiness with fresh, reproducible evidence.

**Current State:** Strong unit suite; DB/LIVE tests are environment-gated; browser timing flake signal exists.

**Gap:** Complete post-implementation gates, integration DB, CLI proof, LIVE classifications, and independent review.

**Why:** No completion claim is valid without fresh verification.

**Dependencies:** All selected V1 implementation tasks: W1, W2, W3, W4, W5, W6, W7, W8, W9, W11, W12, W13, W14, W15, W16, W17, W18, and W19 tasks. `W10-T01` is explicitly excluded.

**Verified files/modules:** Root scripts, integration tests, browser mocks, new task tests.

**Verified symbols/contracts:** Native project commands and new E2E fixtures.

**Behavior to Add/Change:** Run targeted tests, full typecheck/test/build/Drizzle/diff check, disposable TEST DB integrations, secret/PII scans, repeated timing-sensitive browser tests, CLI E2E, and LIVE COTIK/AdsPower matrices when available. Archive W0-T02 Luna review as model-promotion evidence.

**What MUST NOT Change:** Do not weaken gates, convert environment failures to code failures, or wait for optional Cloak research.

**Data migration impact:** Verify forward and rollback/compatibility behavior on disposable DB.

**Tests Required:** Complete matrix in Part E.

**Acceptance Criteria:** All available gates pass; unavailable LIVE checks are explicitly pending; independent reviewer approves. Optional Cloak status cannot affect verdict.

**Evidence Required:** Machine-readable command logs, sanitized runtime captures, reviewer verdict.

**Risk Level:** HIGH.

**Parallelizable:** NO; final barrier.

**Suggested Executor:** Ox-Alpha only if promoted, otherwise a proven verification owner.

**Independent Reviewer:** Luna or another model independent from the majority implementer.

**Rollback / compatibility:** Roll back only failing bounded wave; retain immutable history.

## 26. Authoritative Task Dependency Graph

Each line lists direct dependencies.

```text
W0-T01  ← none
W0-T02  ← W0-T01
W10-T01 ← W0-T01

W11-T01 ← W0-T01
W11-T02 ← W11-T01

W1-T01  ← W11-T01
W1-T02  ← W1-T01, W11-T02

W2-T01  ← W1-T01, W11-T01
W2-T02  ← W1-T02, W2-T01, W11-T02

W3-T01  ← W2-T01
W3-T02  ← W3-T01, W19-T01

W5-T01  ← W0-T02, W11-T02
W5-T02  ← W5-T01, W11-T01
W4-T01  ← W1-T01, W5-T02, W11-T02

W13-T01 ← W0-T01
W13-T02 ← W13-T01

W12-T01 ← W2-T01
W12-T02 ← W5-T02, W12-T01, W13-T01

W6-T01  ← W5-T02
W6-T02  ← W6-T01
W7-T01  ← W6-T02, W11-T02
W7-T02  ← W7-T01
W9-T01  ← W7-T02
W9-T02  ← W9-T01
W8-T01  ← W5-T02, W6-T02, W7-T02, W9-T02

W14-T01 ← W0-T01
W14-T02 ← W14-T01

W16-T01  ← W0-T01
W16-T02A ← W16-T01

W15-T01 ← W5-T02, W8-T01, W12-T02, W13-T02, W14-T02
W15-T02 ← W15-T01, W16-T01

W17-T01 ← W5-T02, W12-T01, W12-T02, W13-T02

W19-T01  ← W3-T01, W5-T02, W12-T02, W15-T02, W16-T01
W16-T02B ← W16-T01, W19-T01
W3-T02    ← W3-T01, W19-T01
W19-T02   ← W6-T01, W13-T02, W14-T02, W19-T01

W18-T01 ← W2-T02, W8-T01, W12-T02, W14-T02,
           W15-T02, W16-T02A, W17-T01

W20-T01 ← W1-T01, W1-T02,
           W2-T01, W2-T02,
           W3-T01, W3-T02,
           W4-T01,
           W5-T01, W5-T02,
           W6-T01, W6-T02,
           W7-T01, W7-T02,
           W8-T01,
           W9-T01, W9-T02,
           W11-T01, W11-T02,
           W12-T01, W12-T02,
           W13-T01, W13-T02,
           W14-T01, W14-T02,
           W15-T01, W15-T02,
           W16-T01, W16-T02A, W16-T02B,
           W17-T01,
           W18-T01,
           W19-T01, W19-T02

W10-T01 ↛ W20-T01
```

## 27. Topologically Valid Execution Waves

Tasks within a subwave may run in parallel only when file ownership does not overlap. Shared `packages/domain` contracts and `packages/db/src/schema.ts`/migration journal have one writer at a time.

| Wave | Tasks | Gate / parallelism |
|---|---|---|
| 0A — Baseline freeze | `W0-T01` | Documentation and ownership gate |
| 0B — Evidence/executor evaluation | `W0-T02` | Ox-Alpha bounded evaluation; no production mutation; mandatory Luna review |
| 1A — Provider contract | `W11-T01` | Shared provider interface gate |
| 1B — Independent pure contracts/research | `W13-T01`, optional `W10-T01` | May run parallel; Cloak is non-gating |
| 1C — AI task schema | `W14-T01` | Single DB/schema writer |
| 1D — BA decision schema | `W16-T01` | Serialized after 1C if migrations overlap |
| 1E — BA CLI contract | `W16-T02A` | CLI-first; depends only on W16-T01 |
| 2A — Provider persistence/client | `W11-T02`, `W1-T01` | Parallel only with separate DB/client ownership |
| 2B — Settings/bindings/provider factory | `W13-T02`, `W1-T02`, `W14-T02` | Coordinate migration ownership |
| 2C — Finance root-cause fix | `W5-T01` | Implement only W0-T02’s proven design |
| 2D — Canonical Order status delta | `W2-T01` | Serialize enum/migration ownership |
| 2E — Ingestion/read foundations | `W2-T02`, `W3-T01`, `W5-T02`, `W12-T01` | Parallel only with non-overlapping modules |
| 3A — Supplementary COTIK Finance | `W4-T01` | Single schema writer if needed |
| 3B — Target deterministic Rule | `W12-T02` | Requires Finance health, metric, and policy contracts |
| 3C — Refresh settings | `W6-T01` | Single settings migration writer |
| 3D — Historical snapshots | `W17-T01` | Follows target Rule; serialize schema ownership |
| 3E — Restart-safe controller | `W6-T02` | Requires persisted settings |
| 4A — Deactive eligibility/proxy capability | `W7-T01` | Requires controller/provider persistence |
| 4B — Proxy preflight | `W7-T02` | Requires capability evidence |
| 4C — Auth state/credential seam | `W9-T01` | Requires proxy contract |
| 4D — Session recovery completion | `W9-T02` | Requires auth-state contract; manual bootstrap plus canonical re-verification is the V1 completion mode |
| 4E — Authoritative refresh controller | `W8-T01` | Composes health/checkpoint/deactive/proxy/auth |
| 5A — Frozen Case/AI context | `W15-T01` | Resolve requested AI config before Case; persist Case before invocation |
| 5B — AI reviewer output | `W15-T02` | Actual result/provenance only in linked AI Decision |
| 6A — CLI-first composed E2E | `W18-T01` | No Dashboard dependency |
| 6B — Dashboard/read contract | `W19-T01` | May run parallel with 6A when its dependencies are ready |
| 7A — Dashboard/minimal UI surfaces | `W16-T02B`, `W3-T02`, `W19-T02` | All follow W19-T01; separate ownership |
| 8 — Final V1 verification/review | `W20-T01` | Full V1 barrier; excludes optional W10-T01 |
| Optional research lane | `W10-T01` | Any time after W0-T01; never gates readiness |

## 28. Subagent / Model Assignment Map

- Luna remains the default for TypeScript adapters, CLI/Dashboard work, and focused integration tasks.
- Ox-Alpha suggestions are provisional, not proof of fitness for every HIGH-risk task.
- `W0-T02` is Ox-Alpha’s initial bounded evaluation because it prohibits production mutation, has clear evidence, and is independently testable.
- Luna must independently review W0-T02 for source accuracy, repository discipline, scope control, tests, and evidence-backed completion claims.
- Only after approval may the Technical Director consider Ox-Alpha for critical DB, auth, concurrency, proxy, or security work.
- Model preference never changes task dependencies, acceptance criteria, or verification gates.
- If Luna implements a task, use Ox-Alpha only as reviewer after promotion or use another independent reviewer. If Ox-Alpha implements after promotion, Luna reviews.
- SOL owns architecture/spec adjudication only and must not implement.
- Every coding agent receives one bounded task, allowed files, direct dependencies, acceptance tests, evidence requirements, and “must not change” constraints.

---

# PART E — QUALITY

## 29. Test Matrix

### Unit

- COTIK body status, HTTP/body 429, `Retry-After`, retry cap, redaction.
- COTIK Orders pagination to `totalsize`, update filters, overlap, mappings, unknown bucket.
- Official Finance On Hold versus Operational Exposure separation.
- Profile 957 capture/read/version semantics and exact selected-population equality.
- Authoritative delivered/total/rate status sets.
- Rule conditions: `TRIGGERED`, `CLEAR`, `NOT_EVALUATED`.
- Overall Rule precedence: any trigger wins; otherwise missing required evidence yields insufficient.
- Stale complete/reconciled Official OH must evaluate while Data Quality remains stale.
- GMT+07 Today/7D/30D/12M/All Available; US proxy/browser timezone independence.
- GLOBAL → optional SHOP override resolution; immutable revisions.
- Caution disabled/absolute/relative; no implicit boundary.
- Finance age/provenance; collected time not upstream time.
- Checkpoint CRUD and GMT+07 wall-clock semantics.
- Restart-safe retry attempt state.
- `deactive` eligibility and manual override.
- Proxy observable states; no expiry inference.
- Auth states and bounded login.
- AI requested config ordering, Case-before-invocation, stale disclosure, no invented facts.
- Model-reported confidence separated from deterministic Data Quality.
- AI/training PII/secret exclusion.
- SLOW_SELL methods and immutable BA revisions.

### Integration

- COTIK binding/client/Orders checkpoint transaction.
- COTIK statements/payments supplementary persistence without Official-OH projection.
- Evidence-selected Finance population/read fix.
- Policy updates affect only subsequent reviews.
- Checkpoint controller locks/attempt audit/restart.
- Existing authenticated session and operator-completed manual bootstrap, each with post-login canonical identity proof; any future normal auto-login remains capability-gated.
- AI task config/Test Connection with server-side secret resolution.
- Case persists before AI; linked AI Decision stores actual result/provenance.
- BA CLI and Dashboard append linked revisions without Case mutation.
- Legacy Case/AI/BA rows remain readable.

### Refresh / fallback

- Fresh → skip.
- Stale → authoritative Seller Center refresh.
- Auto OFF.
- Manual refresh.
- Arbitrary configurable checkpoints.
- Five default attempts with transient recovery.
- Retry exhaustion and next checkpoint/day.
- Success then later checkpoint health reevaluation.
- Deactive automatic skip and manual action.
- Proxy unknown/degraded/unavailable.
- Missing credentials fail closed, challenge/manual action, auth failure, and manual-bootstrap re-verification.
- Seller Center reconciliation fail closed.
- Future provider capability ordering only after explicit promotion proof.

### AI

- Task unset/disabled.
- Provider connection failure.
- Case exists before invocation.
- Known stale snapshot reaches AI with mandatory disclosure.
- Missing/incomplete/unreconciled Official OH is not fabricated.
- AI may disagree with Rule.
- Explanation includes actual values/counts/differences.
- Official OH remains distinct from Operational Exposure.
- Effective policy/caution reaches frozen context.
- No implicit near-threshold number.
- Model-reported confidence label and deterministic Data Quality separation.
- No recipient name/phone/full address or secret in prompt.
- Actual reported model/runtime provenance remains outside Case.

### Regression

- Existing Seller Center Finance pagination/reconciliation unchanged unless explicitly justified by evidence.
- Existing Orders pagination and data preserved.
- Profile identity mismatch remains fail-closed.
- Existing Decision Cases/AI Decisions/BA revisions/history remain readable.
- Existing metric semantics preserved where not explicitly versioned.
- DRY_RUN/no Seller Center write constraints remain.
- Timing-sensitive mocked browser tests repeated when changed.

## 30. Evaluation / Verification Matrix

| Gate | Command / evidence | Required outcome |
|---|---|---|
| Targeted task tests | `pnpm exec vitest run <task tests>` | PASS before review |
| Type safety | `pnpm typecheck` | PASS |
| Full suite | `pnpm test` | PASS; skipped tests explicitly listed |
| Build | `pnpm build` | PASS after implementation |
| Schema | `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts` | PASS |
| Diff hygiene | `git diff --check` | PASS |
| DB integration | Disposable `TEST_DATABASE_URL` migration/integration | PASS |
| Privacy/security | Static payload/fixture scan plus tests | Zero prohibited leak |
| Browser stability | Changed timing-sensitive tests repeated at least five times | Stable PASS |
| CLI E2E | Locked guided flow using fake adapters then persisted DB | Deterministic PASS |
| COTIK LIVE | Token-scoped read-only smoke | PASS or ENVIRONMENT_PENDING |
| AdsPower LIVE | Selected eligible non-deactive profile | PASS or BLOCKED_BY_ENVIRONMENT |
| AI LIVE | Server-side configured provider smoke | PASS or ENVIRONMENT_PENDING |
| Independent review | APPROVE or concrete REQUEST_CHANGES | APPROVE required |
| Cloak research | Optional only | Never affects V1 verdict |

## 31. Risk Matrix

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Profile 957 cross-capture/value contamination | Proven / HIGH | W0-T02 evidence before W5 design; exact selected-population proof |
| COTIK Finance semantic misuse | HIGH / HIGH | Separate capability/tables; no Official-OH projection |
| Rule migration rewrites history | MEDIUM / HIGH | Versioned evaluator; immutable old snapshots/readers |
| Rule unavailable condition suppresses valid trigger | MEDIUM / HIGH | Locked tri-state and trigger-first overall precedence |
| AI result mutates Case | MEDIUM / CRITICAL | Resolve config pre-Case; persist Case pre-invocation; linked results only |
| Shared schema conflicts in dirty worktree | HIGH / HIGH | W0 ownership, one migration writer, bounded tasks |
| Retry scheduler duplicates | MEDIUM / HIGH | DB uniqueness, locks, persisted nextAttemptAt |
| Auth/proxy secret leak | MEDIUM / CRITICAL | Server-only refs, redaction, privacy tests, independent security review |
| COTIK HTTP/rate quirks | MEDIUM / MEDIUM | Central client and bounded retries |
| Dashboard mixed timebases | Proven / MEDIUM | Versioned current vs Case vs linked-record DTOs |
| Browser timing flakes | Observed / MEDIUM | Focused repeated tests; event/deadline design |
| AdsPower unavailable | Current / MEDIUM | Environment classification; mock/DB gates; no weakening |
| Scope creep to writes or Cloak | MEDIUM / HIGH | Explicit DEFER and non-gating research |
| Unproven Ox-Alpha critical ownership | UNKNOWN / HIGH | W0-T02 bounded evaluation plus mandatory Luna promotion review |

## 32. Rollback / Compatibility Notes

- Every schema change is additive; do not drop/rename existing columns or values in V1.
- Old Decision Cases and linked records remain readable through versioned compatibility parsers.
- Existing Seller Center provider remains available when COTIK Orders is enabled.
- COTIK can be disabled per binding without deleting imported canonical facts.
- Automatic refresh has a global kill switch; manual Finance sync remains.
- New target Rule is versioned; historical operational Rule snapshots are never rewritten.
- Settings use immutable revisions; rollback activates a prior or compensating revision.
- `SLOW_SELL` adds a value and nullable fields; old rows/clients remain valid.
- Failed work rolls back only the bounded wave. Immutable production history is retained.
- Optional Cloak research can be discarded independently.

---

# PART F — COMPLETION

## 33. V1 Definition of Done

V1 is complete only when:

1. COTIK Orders normal path is functional for configured/bound shops and fails closed.
2. COTIK statements/payments remain supplementary unless a future proof explicitly promotes Official-OH capability.
3. Current Official Finance reads are evidence-scoped/version-correct, and the profile 957 regression is resolved or explicitly proof-unavailable rather than falsely reconciled.
4. The target Rule uses Official Finance On Hold and authoritative Delivery Rate under effective revisioned GLOBAL/SHOP policy.
5. Every Rule condition uses `TRIGGERED | CLEAR | NOT_EVALUATED`, and overall trigger-first precedence is implemented.
6. A stale complete/reconciled Official-OH snapshot must still be evaluated while Data Quality remains stale and every consumer sees the warning.
7. Global/shop/caution/refresh/AI settings are persisted and editable.
8. GMT+07 checkpoints and bounded retries survive worker restart; US proxy/browser timezone never changes business time.
9. `deactive`, proxy preflight, auth recovery, and identity re-verification follow locked states.
10. Requested AI config resolves before Case construction; Case persists before invocation; actual AI output/provenance remains linked and separate.
11. AI can provide disclosed stale-snapshot advice, with model confidence separate from deterministic Data Quality and no PII/secrets.
12. BA supports all five decisions and stores SLOW_SELL planned methods as append-only revisions.
13. CLI proves the complete flow before Dashboard completion.
14. Dashboard exposes correct current/Case/AI/BA timebases, minimal Settings, and Order Explorer.
15. Existing collectors, history, privacy, and DRY_RUN constraints pass regression gates.
16. All available verification passes; environment-gated LIVE checks are truthfully classified.
17. Optional CloakBrowser research is not required.

## 34. Explicitly Deferred V2/V3

- Automatic Seller Center/COTIK writes.
- Holiday Mode/Resume/Pause execution.
- Tracking/price/stock changes.
- CAPTCHA solving or security bypass.
- Production Cloak-managed browser/session migration.
- Autonomous AI.
- RAG, fine-tuning, calibrated confidence, and outcome learning.
- Seller/person/BA policy hierarchy.
- Broad CRM/RBAC implementation.
- PII-rich training data.
- Final polished analytics Dashboard.

## 35. Recommended First Implementation Task

Start with **W0-T01 — Freeze Approved Baseline and Contract Ownership**, followed immediately by **W0-T02 — Reproduce and Classify the Profile 957 `$0.41` Gap**.

W0-T02 is also the bounded Ox-Alpha evaluation. It permits no production mutation and requires independent Luna approval before Ox-Alpha is considered for additional HIGH-risk Tool_TTS work.

## 36. READY FOR IMPLEMENTATION: YES

No true planning blocker remains. AdsPower, COTIK, and external AI LIVE checks are environment-gated verification items, not implementation blockers. Optional CloakBrowser research is excluded from V1 readiness.

Implementation must occur in a fresh execution session, one bounded task at a time. This document authorizes planning/execution sequencing only; it does not authorize SOL to implement.
