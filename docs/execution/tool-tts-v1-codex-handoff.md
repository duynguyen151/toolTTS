# Tool_TTS V1 — Codex Handoff Checkpoint

This checkpoint records repository truth at the pause boundary. The locked authority remains [`docs/plans/2026-08-25-tool-tts-v1-master-plan.md`](../plans/2026-08-25-tool-tts-v1-master-plan.md); task state remains authoritative in [`docs/execution/tool-tts-v1-execution-ledger.md`](tool-tts-v1-execution-ledger.md). This file does not change task acceptance.

## Orientation addendum (2026-08-27)

- Current HEAD is `9c29ac5` (`docs: add Codex handoff checkpoint`); the
  baseline snapshot below deliberately records the preceding pause boundary.
- The working tree has since gained active, unaccepted W9-T01 auth/credential
  seam WIP (including migration `0040_parallel_ironclad`) and additional
  Dashboard/operations WIP. Neither stream is ledger-accepted; do not mix it
  into W12-T02 review, documentation work, or another task.
- The W12-T02 reviewer-requested provider guard and contradictory-capability
  regression are present as uncommitted edits in `packages/domain/src/target-rule.ts`
  and `packages/domain/src/target-rule.test.ts`. They are implementation
  evidence only until focused verification, independent approval, a commit, and
  a deliberate ledger update occur.
- The root `public-api-guide.md` was an unreferenced ignored byte-for-byte copy
  of the intentionally ignored local COTIK guide. It was removed during
  documentation hygiene; the local ignored guide remains the only copy and
  must not be staged, printed, or copied.
- Fresh orientation checks passed for the W12-T02 target-rule test (18 tests),
  domain typecheck, and Drizzle schema check. A full suite run had one
  Finance-telemetry timing failure that passed in an isolated rerun; it remains
  unclassified rather than accepted evidence. Dashboard typecheck/build expose
  a concrete WIP integration gap: the new shop route imports
  `unlinkShopByProfileNo` and `updateShopDisplayName`, but the DB package index
  does not export either query. This is unrelated to W12-T02 and must be owned
  by the Dashboard/WIP stream.

## Repository state

- Branch: `codex/v1-boss-dashboard-merge`
- HEAD: `b39cc1737e5ada16d7a9618d5fa6f9fbf617ea55`
- Index before this documentation commit: clean.
- Preserved worktree WIP: 29 tracked modified files and 21 untracked files.
- No reset, clean, stash, restore, checkout, switch, merge, rebase, push, amend, or broad staging was performed.

### Tracked modified WIP

```text
AGENTS.md
apps/dashboard/app/dashboard/page.test.ts
apps/dashboard/app/dashboard/page.tsx
apps/dashboard/app/globals.css
apps/dashboard/components/dashboard/dashboard-overview.module.css
apps/dashboard/components/dashboard/dashboard-overview.test.ts
apps/dashboard/components/dashboard/live-ba-form.tsx
apps/dashboard/components/dashboard/order-health.tsx
apps/dashboard/components/shell/app-shell.tsx
apps/dashboard/components/shell/navigation.tsx
apps/dashboard/components/shell/sidebar.tsx
apps/dashboard/components/shell/top-bar.tsx
apps/dashboard/lib/dashboard-contract.ts
apps/dashboard/lib/dashboard-model.test.ts
apps/dashboard/lib/dashboard-model.ts
apps/dashboard/lib/dashboard-read.test.ts
apps/dashboard/lib/dashboard-read.ts
apps/dashboard/lib/server/operations/dashboard-operations.test.ts
apps/dashboard/lib/server/operations/dashboard-operations.ts
apps/dashboard/styles/tokens.css
packages/db/src/migrations.test.ts
packages/db/src/queries/shops.ts
packages/seller-center/src/adspower/client.test.ts
packages/seller-center/src/adspower/client.ts
packages/seller-center/src/errors.ts
packages/seller-center/src/index.ts
packages/seller-center/src/source/finance-reconciliation.ts
packages/sync/src/index.ts
packages/sync/src/profile-verification.test.ts
```

### Untracked WIP

```text
TOOL_TTS_DEEPSEEK_HARNESS_CONTEXT.md
Tool_TTS_V1_Master_Prompt_revised.md
apps/dashboard/app/api/shops/[profileNo]/route.test.ts
apps/dashboard/app/api/shops/[profileNo]/route.ts
apps/dashboard/app/api/shops/route.test.ts
apps/dashboard/app/api/shops/route.ts
apps/dashboard/app/landing.module.css
apps/dashboard/app/shops/[profileNo]/page.tsx
apps/dashboard/app/shops/[profileNo]/shop-detail-client.tsx
apps/dashboard/app/shops/[profileNo]/shop-detail.module.css
apps/dashboard/app/shops/page.tsx
apps/dashboard/app/shops/shops-client.tsx
apps/dashboard/app/shops/shops.module.css
apps/dashboard/components/operations/floating-task-bar.module.css
apps/dashboard/components/operations/floating-task-bar.tsx
apps/dashboard/components/operations/global-task-context.test.ts
apps/dashboard/components/operations/global-task-context.tsx
apps/dashboard/lib/operations-console-contract.ts
apps/dashboard/lib/operations-console-read.test.ts
apps/dashboard/lib/operations-console-read.ts
apps/dashboard/lib/operations-console-safety.test.ts
```

The untracked local COTIK guide `docs/integrations/cotik/public-api-guide.md` remains intentionally ignored and must not be printed, staged, committed, or copied.

## Ledger-accepted tasks

The following rows are `DONE` with `APPROVE` in the execution ledger. Commit/checkpoint identifiers are reproduced from that ledger; consult it for full evidence and notes.

```text
W0-T01    17fa6002797590741a123b0481410cb515454a3f
W0-T02    ebebcb53c775178fe5189435ffc9e7fe42b29cd8
W11-T01   13b8dfcf55d897064ff0bd993e78d756082293c5, 373a6a211dcaf8006444593a92320a2e500a29d1
W11-T02   c84df5f6517010c97d2214b6daf32267ba65af6d, cfc993363a343f5fb3e71433d91a865f44523216
W1-T01    9e5c608e1781a20aac768f37337187a4a12c0365
W1-T02    7dfbaa2e8db28a1c19bb1deb6d61e42ac5696397, 8de8929c959d8ddf9e12449ca08a787dc338ea22
W2-T01    6432f21
W2-T02    b1068b46584fc8642bf1dd9519dd750ef8c476ce, b2b82c010d55a73622d3be8cf20d01e9cbc8a38b, 39202db29f2453013924cadd57e3653e188e99d9
W3-T01    3c70c64956868040ed1c67ef9e49a7ce727ff165, b53ba6337df6a555cee197d548ccea4ef0f6950b
W12-T01   49b39a7fe1fa445771762aaa9de09cad886a1b70, a52444335bf4910fb0142291a6b5a8c09be0e6c4
W13-T01   189355ae9cad09184e71d083dac3a7fa484667fb, 60acc1466ed082bc2df84c0ec0ec467682a7d74d, 5e44493a168a65e623ce8e3e856059521becd19c
W13-T02   5bd56589c8ab62338e20c7d3905fc734e8c159f2, 6fbc169066f473b6dfa98b4aee50957bcde6696e, f1a50f5db49bebbd4e3cb9729d2c22e5b3f69ce2, 2b280391d76ad295dff6575bd290ac005a7d1a6c
W16-T01   b75ed5f57bead242282e0e11fac9efdf6e9120c3, ff456e95c01d176361e31eb1b4686db6e0dacd24
W5-T01    4f42f0437dc37e1791de3abe5114edd2600c31bb, 91d4a28f083c7b6c4bfef8fd5e84b5d201505dc7, 96d7110781cbd3821b6ef743bf8b0c9d49a41203, f7ad4dd865922e827d7575a67c6d762e74d05aa4, 1977ac6d8940bdc1689a56a9f835d85b90054003, ac16e046efb81acc0b103f41259c2a2059fd10db
W5-T02    1df83ef951e36f30ece1637931ea2837ab5c5d6b
W14-T01   571ab6f8fa4ff8d73060af17aeb4757bfee4e907, adb3d9e5fea01e888c78ea7f3282d5387a756783, 8265d4eeaaa3cde674cef47225435d1f6d727c94
W14-T02   97db13a56f4c21d0c753673b3b9700c6cf03f6c6, 6755eab4ab928bb52cb006b4cb7935d05b0e557a, 156216eb683529c4ae085eaf35cc775df189e8a7, 034d336cb67c385a9570a977d217425b1cb8e2e4, d483569fa124d2bc16da3df42f0b1b438c8b5e02, e7f4d172fa09b5edb7745c2ed96d408d5457fca6, de213d063c5dc37e15d00dbbac4518c682248cd3, 204fe040fdd7074f254b4ca4157b152853ccdd91
W6-T01    8161808e62da4153816575cf21f030837d032703, c913ae09715934022cf9985f71ddcd18afafe49c, c04d948c996a5ba8f34bc07dda1ce4ccd6456c66
W6-T02    204ad92c30c5824864e55a8742d608518ed9298a, 6c0a2b68ea27cd78d3268e1b702de98a17cfa7bb, 88810434ed07a86917d61294d763acdbcf370275
W7-T01    e29dbeeb7d002bbdad7a4423ab5820554e2cc344, a89815f735f7c1c087b5c7f5056a5f8da299736, de60998ad5e43800f25f2ba4dc174bc90ac12803, ac27cff4dadbdbb5f2f2be46cc99d344e79218cb, 6fa9b135fd0aa9e488bea281693bc79e87e7916d, 520ad73decbb20bbdd9c99c988b62a2965bd6dd2, 7bdb221c1fe7049ea56349184bc4d93d1aa3bc48
W7-T02    4dd1f9913bf181c3255abdb27d92a045473b8bae4, 7e0b28cf57ccde5f96e3d7f6f9bcbd07ae4c3291, 5a426d885db1e15b8df73db1a8ee57adcc927995
W16-T02A  6563c32
W4-T01    8696bb60f0ff391c9321a7f1dacc3e4f6943737c
```

## Current active/unaccepted state

- `W12-T02` is implemented and repaired but is **not ledger-accepted**.
- No W12-T02 acceptance row exists in the ledger.
- The current implementation commit is `d891d5e647217435f651ba54a8ff77e56c17d4a5`.
- The repair commit is `b39cc1737e5ada16d7a9618d5fa6f9fbf617ea55` (current HEAD before this handoff commit).
- No production implementation was continued after the latest review.

### W12-T02 verification and review

Director-run post-repair evidence:

- Focused Vitest: 6 files, 84 tests passed, including target-rule, workflow, persisted workflow, DB order-provenance, and CLI review regressions.
- Affected package typechecks passed for domain, decision-workflow, DB, sync, and CLI.
- Affected package builds passed for domain, decision-workflow, DB, sync, and CLI.
- `git diff --check` and `git show --check HEAD` passed.
- No Drizzle check was needed for the repair because it added no schema or migration.

Latest completed independent Terra-review verdict: `REQUEST_CHANGES`. The earlier two blockers were closed by `b39cc17`: CLI now selects the latest successful `ORDERS` run and carries delivery coverage/freshness; persisted order provenance fails closed for COTIK, mixed, legacy, and unknown populations. The remaining Important finding is concrete: `evaluateOfficialOnHoldRule` checks the Official-OH capability but does not require `health.provider === "SELLER_CENTER"`; a schema-valid contradictory COTIK/provider-capability input can therefore satisfy Official-OH. The review requested an explicit provider guard and regression test. No follow-up implementation or review was started at this pause.

Implementation/test success and the `REQUEST_CHANGES` review do not constitute acceptance. W12-T02 must remain unaccepted until a completed independent reviewer returns `APPROVE` and the ledger is deliberately updated.

## Environment-pending checks

- `TEST_DATABASE_URL` and `DATABASE_URL` are unset.
- PostgreSQL integration tests and live migration/application evidence remain unavailable or skipped where recorded by the ledger.
- Live AdsPower, Seller Center, and COTIK evidence is unavailable; no live-service claim is made here.
- Existing ledger rows retain their own `ENVIRONMENT_PENDING` notes; consult the ledger rather than treating static/unit evidence as live integration evidence.

## Remaining DAG work

Dependencies and wave ordering below are from the locked Master Plan DAG and do not schedule work by themselves.

Required, not ledger-accepted:

```text
W12-T02  Versioned Official-OH Shop Health Rule (implementation exists; review blocked)
W9-T01   Auth state/credential seam
W9-T02   Normal auto-login
W8-T01   Authoritative refresh controller
W15-T01  Frozen Case/AI context
W15-T02  AI reviewer output
W17-T01  Historical snapshots
W19-T01  Dashboard/read contract
W16-T02B Dashboard BA submission/history
W3-T02   Dashboard/report surface
W19-T02  Remaining Dashboard/read surface
W18-T01  CLI-first composed E2E
W20-T01  Final V1 verification/review
```

Determinable READY tasks at this checkpoint:

```text
W12-T02  (all locked dependencies are accepted; implementation is awaiting repair/review)
W9-T01   (W7-T02 accepted)
```

`W10-T01` is optional, non-gating, and intentionally deferred. It does not unlock or gate W20-T01. All other remaining required tasks are dependency-blocked by the unaccepted W12-T02 and/or downstream tasks in the locked DAG.

## Ownership cautions

- Preserve all 29 tracked modifications and 21 untracked paths above; inspect status before staging anything.
- `packages/domain` contracts and shared workflow surfaces are one-writer areas.
- `packages/db/src/schema.ts`, migrations, snapshot, and journal are one-writer areas; any DB change requires a forward-only migration plus schema/snapshot/journal parity and `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts`.
- The W12-T02 repair did not add a migration. Do not broaden it into W4 COTIK supplementary Finance or unrelated Dashboard/Seller Center/DB/Sync WIP.
- Historical Operational Exposure evaluator/snapshots, COTIK supplementary semantics, no-automatic-action boundaries, and the locked Master Plan/accepted ledger rows must remain unchanged unless a separately accepted task authorizes otherwise.

## Recommended continuation point

Start a fresh Codex session by reading this checkpoint, the locked Master Plan DAG/W12-T02 section, and the execution ledger; verify branch/HEAD/status; inspect only the committed `d891d5e..b39cc17` W12-T02 range. Then address the single reviewed Important finding with a minimal provider guard plus a contradictory-capability regression, rerun focused and affected gates, obtain a fresh bounded independent review, and update the ledger only after an actual completed `APPROVE`. After W12-T02 acceptance, recompute readiness from the locked DAG before selecting the next task. Keep W10-T01 deferred and preserve every unrelated dirty path.

## Continuation checkpoint (2026-08-28)

- Branch/HEAD: `codex/v1-boss-dashboard-merge` at `d56fcd1` (`docs(ledger): accept frozen AI decision context`). Preserve the current dirty worktree; no task is being accepted by this checkpoint.
- Closed since the preceding checkpoint: `W12-T02` (`d891d5e`, `b39cc17`, `b43c1da`, `2a87700`), `W9-T01` (`8fcd164`), `W9-T02` manual-bootstrap completion (`917a002`, `462bc66`, `5edc103`), `W8-T01` (`8ca62bf`, ledger `2922998`), `W17-T01` (`9421e93`, ledger `97f4a3c`), `W15-T01` (`24054e7`, ledger `d56fcd1`), and `W16-T02A` (see ledger). These are ledger-accepted closed state; do not re-audit, re-review, or re-run their verification without a concrete regression traced to them.
- Current unfinished task: `W19-T01` and `W18-T01` are READY. `W15-T02` is ledger-accepted and closed; do not re-audit without a concrete regression.
- W15-T02 acceptance: commit `4f42242`; 25 focused CLI/Dashboard presentation/read/model tests passed, CLI typecheck/build passed, and an independent Terra AI safety/business review returned APPROVE. Dashboard typecheck/build remain blocked by unrelated pre-existing shop-route WIP importing missing DB exports `unlinkShopByProfileNo` and `updateShopDisplayName`; this is recorded in the ledger and is not W15-T02 evidence.
- READY after W15-T02 acceptance: `W19-T01` and `W18-T01` (all their other listed dependencies are accepted). `W19-T02` remains downstream of `W19-T01`; `W20-T01` remains final barrier. `W10-T01` remains optional/non-gating.
- Environment constraints remain truthful: `TEST_DATABASE_URL`/`DATABASE_URL` are unset, so PostgreSQL integration/migration evidence stays environment-pending. Live AdsPower/Seller Center/COTIK and operator-completed manual-bootstrap re-verification are unavailable; safe autofill capability is not proven and is not a V1 blocker under accepted W9-T02 semantics.
- Existing unrelated WIP remains extensive in Dashboard operations/pages/styles, DB shops/migration tests, and Seller Center/Sync; retain it untouched. The ignored local COTIK API guide remains off limits.

## Continuation checkpoint (2026-08-28, W19-T01 accepted)

- Branch/HEAD: `codex/v1-boss-dashboard-merge` at `e59b267` (`feat(dashboard): version read provenance contract`). Preserve the dirty worktree; unrelated WIP remains untouched.
- Accepted in this checkpoint: `W19-T01`. Evidence: 30 focused Dashboard read/model/overview/live-decision-center tests passed; CLI typecheck/build passed; scoped diff check passed; independent Luna UI-contract review returned APPROVE after the final timestamp adjustment.
- W19-T01 acceptance details: `dashboard-read.v2` separates current operational facts from immutable Decision Case, linked AI Decision, BA revisions, and dry-run execution; per-value provenance and frozen typed Rule conditions are explicit; current observation uses persisted `latestSync.startedAt` rather than read-generation time.
- Dashboard typecheck/build remain environment/WIP-pending only because unrelated shop-route WIP imports missing DB exports `unlinkShopByProfileNo` and `updateShopDisplayName`; this does not invalidate W19-T01 evidence. Live services remain unavailable.
- READY frontier after W19-T01: `W16-T02B`, `W3-T02`, `W19-T02`, and `W18-T01` (all listed dependencies accepted). `W20-T01` remains the final barrier; `W10-T01` remains optional and non-gating.
- Next scheduling choice: continue with the highest-value READY task under the locked DAG, preserving all existing Dashboard/DB/Seller Center/Sync WIP and avoiding historical re-audit.
