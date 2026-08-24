# W0-T02 Finance Current-Population Decision

## Status

**Evidence-backed diagnosis; production fix deferred to W5-T01.** This task changes no production schema, database data, collector, reconciliation, or query implementation.

## Reproduction matrix

| Required scenario | Evidence | Result |
| --- | --- | --- |
| Same statement ID changes amount/state across captures | `finance.integration.test.ts` W0-T02 diagnostic writes `MUTABLE` as `ON_HOLD/524.2800` at capture A, then `ELIGIBLE/523.8700` at capture B. | Current single row is overwritten; capture A can no longer read its original amount/state. |
| A row exists in capture A but not capture B | Existing `uses only rows seen in the latest complete capture while retaining omitted historical rows`. | `lastSeenAt` excludes omitted rows for B while retaining their latest mutable row for history. |
| Identical snapshot hash with changed population | Same existing test inserts capture B with capture A's `snapshotHash`. | Snapshot dedup leaves only the A snapshot; a run capture timestamp can be newer than the stored snapshot. |
| Latest successful sync versus latest stored snapshot | `persisted.test.ts` asserts `resolveFinanceCaptureAt` uses the successful run's `sourceCapturedAt`, and Finance query selects snapshot at-or-before that capture. | Selection is intentional but cannot restore overwritten settlement values. |
| Simple row-ID membership sufficiency | W0-T02 mutable-ID diagnostic. | Insufficient: `capture_id -> settlement_row_id` would still point at a row whose amount/state were overwritten after capture A. |

## Root cause classification

The collector reconciliation is not the demonstrated cause. `assertOnHoldReconciled()` uses exact-decimal arithmetic and rejects incomplete or mismatched source rows before persistence.

The gap class is **cross-capture mutable-row contamination**:

1. `upsertSettlementBatch()` identifies a settlement by `(shopId, sourceStatementDetailId)` and overwrites amount, state, reason, source hash, and `lastSeenAt` when later source data differs.
2. `getFinanceSummary(shopId, captureA)` scopes rows by `lastSeenAt = captureA`; after a same-ID update at capture B, that row is absent from A's population rather than represented at its A value.
3. A Finance snapshot preserves the official total, but not immutable per-settlement capture values. Thus the current read can compare a selected snapshot with a population that no longer represents its captured rows.
4. Snapshot hash deduplication can additionally cause a newer completed run to select an older equal summary snapshot. That is acceptable only if the selected settlement population/value version remains provable; it does not do so for mutable same-ID rows.

This mechanism can produce a visible delta such as profile 957's `$524.28` snapshot versus `$523.87` aggregate. This task does **not** claim a fresh live profile-957 database reproduction because `TEST_DATABASE_URL` is unavailable and production data was not queried or mutated.

## Candidate comparison

| Candidate | Result |
| --- | --- |
| Query scoping by `lastSeenAt` only | Reject. Correctly excludes rows omitted later but loses a prior same-ID value/state after overwrite. |
| Snapshot selection only | Reject. Selects an official total but does not reconstruct a matching item population. |
| Capture-to-row-ID membership only | Reject. Row IDs reference mutable rows and cannot retain capture truth. |
| Correct dedup/upsert semantics alone | Insufficient without proof that all source IDs are immutable in value/state; current upsert intentionally supports change. |
| Immutable capture-item values (or row versioning) for selected captures | Selected W5 direction. Preserve at minimum immutable source statement ID, amount, state, reason, currency, and capture identity/time for every complete/reconciled Finance capture; compute a current Official-OH read from that immutable selected capture population. |

## W5-T01 ruling

Use **immutable capture-time Finance item values (or equivalent row versioning)** only for complete/reconciled capture evidence. A membership-only relation is prohibited unless implementation first proves settlement rows cannot change after capture. The read must either reconcile exactly to its selected official snapshot or report `PROOF_UNAVAILABLE`; it must not silently aggregate mutated rows.

Legacy captures that cannot reconstruct immutable capture items remain explicitly `PROOF_UNAVAILABLE`. Do not fabricate or backfill historical values from later mutable rows.

## Verification record

- `pnpm exec vitest run packages/db/src/queries/finance.test.ts packages/sync/src/finance-sync.test.ts packages/decision-workflow/src/persisted.test.ts`: PASS, 3 files / 20 tests.
- `TEST_DATABASE_URL`: `UNSET`; integration suite—including the W0-T02 diagnostic—is skipped by repository policy. Disposable PostgreSQL execution is **ENVIRONMENT_PENDING**.
- The W0-T02 diagnostic is intentionally marked `it.fails`: when a disposable DB is available it captures the missing historical-value invariant without changing production behavior. It must be converted to a normal passing regression only by W5-T01 after the evidence-selected persistence/read fix.
- No LIVE profile, production database, schema, migration, collector, reconciliation, or production query was changed.
