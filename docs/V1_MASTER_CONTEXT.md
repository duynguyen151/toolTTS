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
