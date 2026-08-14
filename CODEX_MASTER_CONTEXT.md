# Tool_TTS — Master Project Context for Codex

## 0. Purpose of this file

This is durable product/architecture context for the Tool_TTS repository.

Codex must use this file to understand:
- what the product is;
- why it exists;
- what V1 must deliver;
- how V1 becomes training/evaluation data for V2;
- what architecture is already in place;
- what business rules are currently locked;
- what AI is allowed/not allowed to do;
- which open-source components may reduce implementation burden;
- what should not be over-engineered.

This file is NOT proof that every described capability already exists.

When repository reality conflicts with this document:
1. inspect source;
2. report the conflict;
3. preserve working implementation;
4. propose the smallest compatible change.

Do not rebuild the repository from zero.

---

# 1. Product Mission

Build a TikTok Shop health/risk decision-support tool.

Near-term product flow:

```text
TikTok Shop Seller Center
    ↓
AdsPower + Playwright/CDP
    ↓
Normalize + Persist
    ↓
Metrics + Risk Rules
    ↓
AI Recommendation
    ↓
Dashboard
    ↓
BA reviews
    ↓
BA decides
    ↓
Optional execution
    ↓
Decision is recorded
    ↓
Decision dataset becomes memory/evaluation data for V2
```

The system is NOT intended to be a generic TikTok bot.

---

# 2. Current Data Acquisition Strategy

Current V1 does NOT use TikTok Shop Open API.

Current source:

```text
AdsPower Local API
    ↓
Existing logged-in AdsPower browser profile
    ↓ CDP / Playwright
TikTok Shop Seller Center
```

Important:

- Seller accounts are already logged in inside AdsPower profiles.
- Do not require TikTok Partner/Developer account for current V1.
- Core code must not bypass CAPTCHA/security challenges.
- If login/challenge is detected:
  - detect;
  - pause;
  - persist state;
  - notify;
  - require manual resolution;
  - resume later.
- Do not persist/export browser cookies or session secrets unless technically unavoidable.
- Keep browser acquisition replaceable so a future TikTok Open API data source can replace it without rewriting domain metrics/AI/dashboard.

---

# 3. Current Repository Architecture

Current monorepo:

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
```

Current areas:

```text
apps/cli
apps/worker

packages/seller-center
packages/sync
packages/db
packages/domain
```

## `apps/cli`

`shop-health` CLI.

Used for:
- shop management;
- sync;
- reading persisted data;
- metrics;
- reports;
- risk evaluation.

## `apps/worker`

Current scheduler/poller.

Used for:
- enabled shop polling;
- orders/finance sync;
- risk evaluation.

## `packages/seller-center`

Responsibilities:
- AdsPower connection;
- CDP/Playwright connection;
- Seller Center response capture;
- source validation;
- normalization.

## `packages/sync`

Responsibilities:
- sync orchestration;
- checkpoints;
- advisory locks;
- persistence;
- pause/failure states;
- stale-write protection;
- sync audit.

## `packages/db`

PostgreSQL + Drizzle.

Responsibilities:
- schema;
- migrations;
- query layer;
- locking/concurrency support.

## `packages/domain`

Pure deterministic business logic.

Hard rule:

> `packages/domain` must not depend on browser, AdsPower, PostgreSQL, Drizzle, network, UI, or LLMs.

Contains:
- contracts;
- KPI formulas;
- recommendation logic;
- risk policy.

---

# 4. Current Confirmed Repository State

At the latest inspection:

- TypeScript/Node.js monorepo.
- Backend-first.
- No HTTP API yet.
- No web UI yet.
- No Redis.
- No BullMQ.
- No production LLM integration.
- US / `en-US` only.
- Holiday Mode remains `DRY_RUN`.
- Orders and finance persistence are idempotent.
- Transactional locks and sync-run audit exist.
- Previous fixes include:
  - DB self-deadlock;
  - safe-cycle race;
  - stale writes;
  - audit failure masking source failure.
- Risk evaluation uses all latest order state currently persisted.
- Historical completeness is not guaranteed.
- `sync backfill` is disabled as `BACKFILL_UNRESOLVED`.
- Only confirmed order status mapping:
  - `101 -> AWAITING_SHIPMENT`
- No direct TODO/FIXME/HACK/TBD markers were found at the last repo review.
- Latest validation:
  - `pnpm typecheck` pass;
  - `pnpm test` pass (41 tests at latest summary);
  - `pnpm build` pass.
- Live PostgreSQL E2E/migration verification still requires a valid `DATABASE_URL`.
- Git metadata was absent at last inspection.

Important files:

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
packages/db/migrations/

packages/domain/src/metrics/calculate.ts
packages/domain/src/risk-control.ts
packages/domain/src/recommendation/evaluate.ts
```

---

# 5. Current BA Risk Definitions

Evaluation is per SHOP, not seller-level.

A seller may own several shops; one shop's risk must not automatically affect another.

## Onhold Value

Current BA definition:

```text
Onhold Value =
SUM(order_value)
where status ∈ {
  Delivered,
  Completed,
  Intransit,
  Awaiting Packing,
  Awaiting Collection
}
```

Conceptual groups:

```text
To Ship + Shipped + Completed
```

## Delivered Count

```text
Delivered_count =
COUNT(orders)
where status ∈ {
  Delivered,
  Completed,
  Intransit
}
```

## Total Count

```text
Total_count =
COUNT(orders)
where status ∈ {
  Delivered,
  Completed,
  Intransit,
  Awaiting Packing,
  Awaiting Collection
}
```

## Rate

```text
Rate = Delivered_count / Total_count
```

---

# 6. Current Locked BA Rules

Current V1 rules:

```text
Rule 1:
IF Onhold Value >= 3500 USD
THEN rule result = PAUSE/STOP

Rule 2:
IF Rate < 70%
THEN rule result = PAUSE/STOP

Combined:
IF (Onhold Value >= 3500 USD) OR (Rate < 70%)
THEN rule result = PAUSE/STOP
ELSE CONTINUE
```

Locked for current V1 unless BA explicitly changes them:

- USD 3,500 threshold;
- 70% threshold;
- OR logic;
- current BA status set.

Do not silently "improve" these rules.

---

# 7. Known BA Risks / Exceptions

The deterministic rule is intentionally incomplete.

Known issues:

## R1 — Absolute money vs scale

Onhold Value is absolute exposure.

A high-volume healthy shop may cross $3,500 without deterioration.

Future concepts:
- scale threshold to GMV;
- separate exposure warning from shop-quality risk.

Do not change V1 rule automatically.

## R2 — Low sample size

A shop with 2–3 orders may show unstable percentages.

Future context:
- minimum sample;
- low confidence;
- human review.

## R3 — External logistics

Rate can deteriorate because of:
- carrier outage;
- regional delay;
- natural disaster;
- seasonal overload;
- third-party logistics.

This may not reflect shop health.

## R4 — Detection latency

Polling interval controls risk exposure before detection.

## R5 — Flapping

Values near thresholds may repeatedly toggle state.

Future:
- hysteresis;
- resume buffer;
- stable safe cycles;
- stabilization time.

These known exceptions become important context for V2 AI.

---

# 8. Full-History Decision for Current V1

Current V1 should calculate from:

```text
FULL_PERSISTED_HISTORY
```

Meaning:

> Use all eligible records currently persisted for the shop, with no intentional date cutoff.

This does NOT guarantee the database contains the shop's lifetime history.

Always distinguish:

```text
History Mode
vs
Data Coverage
```

Possible coverage:

```text
COMPLETE
PARTIAL
UNKNOWN
```

Until backfill/pagination is proven, do not claim lifetime completeness.

Preferred wording:

> Metrics are calculated from all historical records currently available in the local database.

---

# 9. V1 Has Been Re-Scoped: Dashboard Is Mandatory

The dashboard is NOT a later cosmetic feature.

It is a core V1 product requirement because:

1. management needs visible daily progress;
2. BA needs a usable interface to review shop state;
3. BA decisions need to be captured as structured data;
4. those decisions become the seed dataset for V2 AI.

V1 target:

```text
DATA
→ METRICS
→ RULE RESULT
→ AI RECOMMENDATION
→ DASHBOARD
→ BA DECISION
→ OPTIONAL EXECUTION
→ DECISION RECORD
```

---

# 10. V1 Dashboard Requirements

At minimum, the main shop list must support BA review of:

```text
SHOP
STATUS
TOTAL ORDERS
GROSS SALES / VERIFIED VALUE
ONHOLD VALUE
DELIVERY RATE
RULE RESULT
AI RECOMMENDATION
AI CONFIDENCE
BA DECISION
LAST SYNC
DATA COVERAGE
```

Useful filters:

```text
Needs BA Review
High Risk
Rule != AI
AI != BA
Onhold threshold breached
Low AI confidence
Challenge Required
Login Required
```

Do not show a metric as zero if it is unknown.

Use:

```text
UNKNOWN
UNAVAILABLE
NOT VERIFIED
```

when appropriate.

---

# 11. Shop Detail / Decision Review Screen

The shop detail page should show:

## Current State

- total orders;
- gross/verified financial values;
- Onhold Value;
- Delivered Count;
- Delivery Rate;
- relevant order status counts;
- refunds/cancel where verified;
- data coverage;
- last sync;
- last successful observation;
- worker/profile status.

## Rule Engine

Example:

```text
RULE RESULT
PAUSE

Trigger
ONHOLD_VALUE

Onhold
$3,812

Threshold
$3,500
```

## AI Recommendation

Example:

```text
AI RECOMMENDATION
WATCH

Confidence
82%

Reason Codes
HIGH_VOLUME_HEALTHY

Reason
High absolute exposure but delivery performance remains strong.
```

## BA Decision

BA can select:

```text
SCALE
CONTINUE
WATCH
PAUSE
```

and provide:
- reason codes;
- optional short note;
- optional confidence.

---

# 12. Rule vs AI vs BA vs Execution Must Stay Separate

Never collapse these concepts.

Example:

```text
RULE RESULT
PAUSE

AI RESULT
WATCH

BA DECISION
CONTINUE

EXECUTED ACTION
NONE
```

Another example:

```text
RULE RESULT
PAUSE

AI RESULT
PAUSE

BA DECISION
PAUSE

EXECUTED ACTION
HOLIDAY_MODE
STATUS
DRY_RUN
```

This distinction is critical for:
- debugging;
- audit;
- V2 training/evaluation;
- future automation safety.

---

# 13. Decision and Execution Are Separate Steps

BA clicking a decision must not automatically imply Seller Center action.

Preferred workflow:

```text
BA chooses PAUSE
    ↓
Save decision
    ↓
Separate confirmation
    ↓
Execute action
```

Execution record should support:

```text
NOT_REQUESTED
DRY_RUN
PENDING
SUCCESS
FAILED
```

Current V1:

> Holiday Mode remains DRY_RUN.

The UI workflow may exist before real Holiday Mode reverse engineering is complete.

---

# 14. Decision Case Capture — Mandatory V1 Data Product

Every BA decision should create an immutable decision context.

Recommended tables/entities:

## `decision_cases`

Snapshot the state AT DECISION TIME.

Suggested fields:

```text
id
shop_id
observed_at

metrics_snapshot JSONB
risk_snapshot JSONB
finance_snapshot JSONB

rule_decision
rule_triggers

data_coverage
source_sync_run_id

created_at
```

Critical rule:

> Never reconstruct an old BA decision using current shop metrics.

## `ba_decisions`

```text
id
decision_case_id

decision
confidence

reason_codes[]
note

created_at
```

Decision:

```text
SCALE
CONTINUE
WATCH
PAUSE
```

## `ai_decisions`

For baseline/shadow AI:

```text
id
decision_case_id

model
prompt_version
policy_version

decision
confidence

reason_codes[]
reason

rule_override
human_review_required

retrieved_case_ids[]

created_at
```

## `decision_executions`

Recommended:

```text
id
decision_case_id
ba_decision_id

requested_action
execution_mode
execution_status
error_code
attempted_at
completed_at
```

---

# 15. Initial BA Reason Codes

Prefer structured labels over requiring long BA essays.

Initial candidates:

```text
HIGH_ABSOLUTE_EXPOSURE
LOW_DELIVERY_RATE
HIGH_VOLUME_HEALTHY
LOW_SAMPLE_SIZE
CARRIER_SYSTEMIC_DELAY
RAPID_ONHOLD_GROWTH
DELIVERY_DETERIORATION
REFUND_SPIKE
DATA_INCOMPLETE
RECOVERY_TREND
THRESHOLD_FLAPPING
OTHER
```

BA may add a short note only when needed.

---

# 16. V1 Baseline AI

V1 DOES need an AI recommendation so management/BA can see:

```text
Rule
vs
AI
vs
BA
```

However V1 AI does NOT need a large RAG brain.

Initial AI input can be:

```text
normalized metrics
+
deterministic rule result
+
known BA risks R1–R5
+
small policy
```

Output MUST be structured.

Example:

```json
{
  "decision": "WATCH",
  "riskLevel": "MEDIUM",
  "confidence": 0.78,
  "ruleResult": "PAUSE",
  "ruleOverride": true,
  "reasonCodes": ["HIGH_VOLUME_HEALTHY"],
  "reason": "High absolute exposure but delivery performance remains stable.",
  "humanReviewRequired": true
}
```

Validate AI output with schema/Zod.

Do not treat free-form text as authoritative state.

Invalid output must fail closed.

---

# 17. V2 Vision — AI BA Decision Intelligence

V2 is NOT simply chatbot RAG.

Target:

```text
Live Shop Data
    ↓
Feature Engine
    ↓
Current KPIs + Trends + Context
    ↓
Rule Result
    ↓
Knowledge + Similar BA Cases + Exceptions
    ↓
AI BA Decision
    ↓
Confidence / Policy Gate
    ↓
CONTINUE / WATCH / PAUSE / HUMAN REVIEW
```

Useful conceptual capabilities:

- semantic memory;
- episodic case memory;
- current working context;
- outcome memory;
- structured reasoning;
- uncertainty/abstention;
- historical similarity;
- external/systemic context.

Do not call this "AI consciousness".

---

# 18. RAG Is Not Training

Distinguish:

## RAG

Retrieves relevant policy/cases at decision time.

## Fine-tuning

Changes model behavior from training examples.

## Statistical Risk Model

Potential later model:

```text
P(shop failure in X days)
P(financial loss > threshold)
```

## Decision Policy

Controls what AI may recommend or execute.

Do not start V2 by fine-tuning.

Initial preferred path:

```text
foundation model
+
structured features
+
rules
+
knowledge
+
validated cases
+
case retrieval
+
confidence gate
```

---

# 19. Fast One-Week AI Dataset Strategy

There is not enough time for thousands of real cases.

Use:

```text
15–30 expert BA seed cases
    ↓
AI generates boundary/exception variations
    ↓
BA validates/corrects candidates
    ↓
50–200 high-value validated cases
    ↓
Case retrieval
    ↓
AI shadow/recommendation evaluation
```

Focus BA effort on boundaries:

```text
When does basic rule say PAUSE but BA says CONTINUE?

When does basic rule say CONTINUE but BA says PAUSE?

What evidence would change the decision?
```

Synthetic candidate cases are NOT trusted truth until BA validates them.

---

# 20. Future AI Evaluation

Do not evaluate only overall agreement.

Track:

```text
AI vs BA
```

especially:

```text
False Continue:
AI CONTINUE
BA PAUSE

False Pause:
AI PAUSE
BA CONTINUE
```

Also:
- confidence calibration;
- human review rate;
- disagreement reasons;
- exception classification;
- high-confidence accuracy;
- later outcome quality.

---

# 21. Open-Source Adoption Strategy

Do not clone all popular repositories into Tool_TTS.

Adoption modes:

```text
INSTALL
COPY SELECTED COMPONENTS
REFERENCE PATTERNS
SELF-HOST EXTERNALLY
```

Codex must justify each dependency:

```text
Problem
Candidate
Benefit
Cost
Alternatives
Decision: ADD / DEFER / REJECT
```

---

# 22. Open-Source Map

## shadcn/ui

Use for V1 dashboard UI:
- cards;
- badges;
- dialogs;
- forms;
- sidebars;
- tabs;
- alerts;
- skeletons.

Adoption:
```text
COPY SELECTED COMPONENTS via official component workflow
```

Do not clone entire repository.

Use NOW because dashboard is V1 scope.

## TanStack Table

Use NOW for:
- shop table;
- decision case table;
- sorting/filtering;
- pagination;
- column state.

Adoption:
```text
INSTALL
```

## Recharts

Use in V1 only for charts that provide direct BA value:
- Onhold trend;
- Delivery Rate trend;
- Health/Risk trend if snapshots exist.

Adoption:
```text
INSTALL
```

Do not chart unreliable data.

## Refine

Optional.

Evaluate if dashboard becomes mostly:
- CRUD;
- forms;
- admin resources;
- repetitive data pages.

If the V1 UI is only a few custom screens, prefer:
```text
Next.js + shadcn + TanStack
```

Do not introduce both competing admin architectures.

## pgvector

V2 later.

Use when case library/semantic retrieval is large enough to justify embeddings.

Preferred over immediately adding a separate vector database because PostgreSQL already exists.

Use hybrid retrieval:
```text
structured filter
+
numeric similarity
+
vector semantic similarity
```

## Vercel AI SDK

Use for V1 baseline/shadow AI integration if it reduces implementation code.

Use for:
- model provider abstraction;
- structured generation;
- schema-based output.

Keep business rules outside the SDK.

## Mastra

DEFER initially.

Evaluate later if AI workflow grows to require:
- multiple tools;
- memory;
- agent workflows;
- retrieval orchestration;
- eval abstractions.

Do not redesign Tool_TTS around Mastra before simple AI flow works.

## Langfuse

Recommended when AI starts making shadow/recommendation decisions.

Use for:
- prompt/model trace;
- retrieved context;
- confidence;
- output;
- BA corrections;
- eval.

Tool_TTS PostgreSQL remains business source of truth.

## Redis/BullMQ/Trigger.dev

DEFER until current worker architecture shows an actual bottleneck.

---

# 23. Engineering Priority

Default priority:

```text
Correctness
→ Maintainability
→ Simplicity
→ Performance
→ Scale
```

Do not optimize for scale before source correctness.

Rules:
- KISS;
- YAGNI;
- controlled DRY;
- strict TypeScript;
- explicit boundaries;
- small functions;
- shallow control flow;
- no premature microservices;
- database integrity first;
- idempotency;
- structured errors;
- no sensitive logging;
- no silent catch;
- no speculative framework layers.

Optimize for:

> Minimum Necessary Complexity.

---

# 24. Parser / Seller Center Rules

TikTok Seller Center is an unstable external UI.

Required pattern:

```text
Page / response
→ extractor
→ raw DTO
→ normalizer
→ domain model
→ persistence
```

Rules:
- no scattered selectors;
- no invented selectors;
- no parser + DB + KPI in same function;
- preserve sanitized fixtures when useful;
- unknown mapping stays UNKNOWN;
- source correctness is more important than UI polish.

---

# 25. Failure-First Design

Expected states:

```text
AdsPower start failure
browser disconnect
session expired
LOGIN_REQUIRED
CHALLENGE_REQUIRED
layout changed
selector missing
partial load
timeout
duplicate sync
DB unavailable
worker crash
```

Pattern:

```text
DETECT
→ CLASSIFY
→ RECORD
→ RETRY / PAUSE
→ RECOVER
```

No infinite retries.

No CAPTCHA/security bypass in core.

---

# 26. Highest-Priority Unknowns

Still important:

1. Map Seller Center status codes beyond `101`.
2. Verify refund mapping.
3. Verify finance/settlement mapping.
4. Verify carrier variants.
5. Identify pagination/backfill behavior.
6. Prove data coverage before marking COMPLETE.
7. Test migrations/persistence/concurrency with live PostgreSQL.
8. Holiday Mode read/write remains unresolved.
9. Future real Holiday Mode must distinguish manual vs automation-owned state.

---

# 27. V1 Delivery Priorities

Current recommended order:

```text
1. Git/reproducible baseline
2. Live PostgreSQL + DATABASE_URL
3. Verify critical Seller Center status mappings
4. Decision Case schema
5. V1 Dashboard
6. BA Decision capture
7. Baseline AI recommendation
8. Rule vs AI vs BA comparison
9. Decision history
10. DRY_RUN execution workflow
```

Dashboard is no longer deferred.

---

# 28. Practical 7-Day Demo Target

Day 1:
```text
Seller Center → PostgreSQL → metrics/risk verified
```

Day 2:
```text
critical status mapping + decision schema
```

Day 3:
```text
dashboard shell + shop list + metrics
```

Day 4:
```text
shop detail + Rule Result + BA decision capture
```

Day 5:
```text
baseline AI recommendation + structured output
```

Day 6:
```text
decision history + AI-vs-BA comparison
```

Day 7:
```text
execution workflow in DRY_RUN + polished demo
```

Desired demo:

```text
TikTok data
→ Dashboard
→ Metrics
→ Rule
→ AI
→ BA decision
→ Execute/DRY_RUN
→ Decision dataset
```

---

# 29. What NOT to Build Yet

Unless explicitly required:

```text
real autonomous Holiday Mode
fine-tuning
generic rule DSL
microservices
CQRS
event sourcing
data warehouse
separate vector DB
complex agent framework
large distributed queue infrastructure
full autonomous AI BA
```

---

# 30. Subagent Workflow

Main model acts as orchestrator.

Preferred:

```text
Main Sol
    ├── read-only explorer
    ├── one bounded writer
    └── read-only reviewer
```

No multiple writers editing the same module.

Each subtask:
- objective;
- files/area;
- assumptions;
- expected output;
- acceptance criteria;
- out of scope.

---

# 31. Definition of Done

A milestone is done only when:
- actual behavior exists;
- input/output can be verified;
- relevant tests pass;
- typecheck/build status is known;
- limitations are explicit;
- external assumptions are not fabricated.

Relevant validation:

```text
pnpm typecheck
pnpm test
pnpm build
```

If live DB E2E is unavailable, report:

```text
NOT RUN
```

Do not claim pass.

---

# 32. Codex Operating Instruction

Whenever continuing this repository:

1. Read this file.
2. Read the current implementation status file.
3. Read the UI/dashboard specification if the task touches UI.
4. Read all applicable rules under `.agent`.
5. Inspect actual source before planning.
6. Report material conflicts between docs and code.
7. Preserve working code.
8. Prefer incremental changes.
9. Do not invent Seller Center behavior.
10. Keep deterministic domain logic separate from AI.
11. Keep Holiday Mode DRY_RUN until explicitly changed.
12. Optimize toward the V1 demo and V2 data flywheel.
