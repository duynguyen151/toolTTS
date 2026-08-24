# Tool_TTS V1 Execution Ledger

## Authority and handling

- `docs/plans/2026-08-25-tool-tts-v1-master-plan.md` is the locked repository-local implementation authority. It owns V1 scope, task contracts, dependency DAG, acceptance gates, and Definition of Done.
- `docs/integrations/cotik/public-api-guide.md` is a local API reference supplied by COTIK, the ERP service in use. It may contain credentials and is intentionally Git-ignored: agents may read it locally when required, but it must not be staged, committed, printed into evidence, or pushed.
- Current source, tests, and runtime evidence establish implementation reality. They do not reopen locked product semantics.

## Locked execution invariants

- Official Finance On Hold is distinct from Operational Exposure; the latter is supporting context only.
- COTIK statements/payments are `SUPPLEMENTARY_FINANCE` only and cannot satisfy Official On Hold.
- Business time is GMT+07 (`Asia/Bangkok`); proxy, browser, seller, server, and exit-IP timezones do not redefine it.
- BA decisions are `SCALE`, `CONTINUE`, `SLOW_SELL`, `WATCH`, and `PAUSE`.
- Requested AI configuration resolves before construction; the immutable Decision Case persists before AI invocation.
- AI advises; BA decides; neither AI nor BA mutates a Case.
- V1 performs no Seller Center or COTIK business write action.

## Exclusive ownership zones

Only one implementation worker may edit each shared integration seam at a time:

- `packages/domain` shared contracts;
- `packages/db/src/schema.ts`;
- Drizzle migrations and journal;
- shared Decision Case contracts;
- shared provider contracts;
- any additional integration seam identified by task investigation.

## Superseded documentation references (do not edit in W0-T01)

- `README.md`, **Risk Rule V1** (lines 70-114): describes operational Onhold/Holiday Mode terminology and is superseded for new V1 reviews by Official On Hold plus authoritative Delivery Rate.
- `README.md` lines 14 and 158: says V1 has no web UI / describes Dashboard as deferred; locked V1 includes minimal functional Dashboard work.
- `CURRENT_IMPLEMENTATION_STATUS.md`, **Master Roadmap** (lines 29-33) and **V1 CLI decision workflow / Current semantics** (lines 139-151): reflects the previous roadmap and four-decision BA model; `SLOW_SELL` and the locked V1 ordering supersede this for new work.
- `CURRENT_IMPLEMENTATION_STATUS.md` line 21: historical RAG wording is deferred under locked V1 scope.

## Git baseline captured before W0-T01

- Workspace: `C:\DUY - DoWorks\Tool_TTS-boss-merge`
- Branch: `codex/v1-boss-dashboard-merge`
- HEAD: `c2f14d41100fffcdd96a311bb4d69515d59f8c10`
- Baseline: 28 modified tracked entries and 25 untracked entries observed before W0-T01.
- Ruling: pre-existing WIP is preserved; no reset, clean, stash, switch, unrelated staging, or unrelated commit is permitted. Counts may change only when a bounded task adds its own artifact.

## Task ledger

| Task ID | State | Direct Dependencies | Scheduled/Unscheduled | Worker | Reviewer | Owned Files/Modules | Tests | Review Verdict | Verification | Accepted Commit/Checkpoint | Blocker | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W0-T01 | REVIEW | None | Scheduled | Technical Director recovery after three no-output worker attempts | Pending independent reviewer | `docs/plans/2026-08-25-tool-tts-v1-master-plan.md`; this ledger | Documentation consistency; Git inventory; placeholder scan; diff check | Pending | Pending independent verification | Pending | None | Documentation-only authority/ownership gate; local COTIK guide is intentionally ignored and excluded from commit. |
| W0-T02 | BLOCKED | W0-T01 | Unscheduled | — | — | Finance query/sync/schema evidence only after W0 acceptance | Required diagnostic/regression tests | — | — | — | W0-T01 pending review | No production schema or data mutation. |

## Scheduling rule

A dependency unlocks only after its task is accepted/done. READY does not mean scheduled. Bootstrap remains sequential: W0-T01, then W0-T02.
