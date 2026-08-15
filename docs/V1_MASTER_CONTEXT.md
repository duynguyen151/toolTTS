# Tool_TTS V1 Master Context

## Product Goal

Tool_TTS V1 is a multi-shop decision-support system.

## Architecture

AdsPower -> Seller Center -> PostgreSQL -> Metric Engine -> Rule Engine -> Trend Engine -> DeepSeek AI -> BA Review -> Audit History -> DRY_RUN

## Locked Decision Model

RULE = deterministic. AI = advisory. BA = final human decision. EXECUTION = DRY_RUN.

## Important Data Semantics

- Official Finance On Hold is not operational exposure.
- Complete within the proven rolling 12-month source window is not lifetime complete.
- No LIVE -> DEMO fallback.

## Profile Semantics

- Profile 957 is a reference profile only.
- V1 is US/en-US only.
- An AdsPower profile exists independently from a linked TikTok shop.

## Master Roadmap

FOUNDATION -> CONTRACT FREEZE F1 -> parallel: A Profile Orchestration, B Decision Intelligence, C Dashboard + BA UX -> D Integration / QA -> Boss UAT.

Future: RAG, learning, and autonomous execution.

## PARALLEL BRANCH OWNERSHIP

### A - Profile Orchestration

Primary ownership: `packages/seller-center/**`, `packages/sync/**`, AdsPower/profile orchestration server operations, and profile verification runtime.

Must not own: Metric/Trend/Rule business logic, DeepSeek analysis logic, Dashboard visual components, or shared schema redesign.

### B - Decision Intelligence

Primary ownership: `packages/domain` decision metrics/trends/rules, `packages/decision-ai/**`, Decision Context construction, and AI analysis persistence/read behavior where appropriate.

Must not own: AdsPower orchestration, Dashboard visual components, or shared schema redesign.

### C - Dashboard + BA UX

Primary ownership: `apps/dashboard/app/**`, `apps/dashboard/components/**`, and dashboard presentation/interactions.

Must not own: Seller Center extraction, metric calculations, Rule calculations, AI reasoning, or shared schema redesign.

### Shared Contract Rule

After F1, A/B/C must not independently redesign shared contracts or database schema. If a branch discovers a missing shared contract/schema requirement, stop and report `SHARED CONTRACT BLOCKER`; do not create an independent migration or schema fix on a parallel branch.
