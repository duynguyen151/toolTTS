# Tool_TTS V1 — Server-Test Checkpoint

This checkpoint is an operator handoff for local server testing. It does **not** mark W20 started, does not change the execution ledger acceptance state, and does not claim live COTIK/PostgreSQL/AdsPower verification.

## Repository snapshot

- Branch: `codex/v1-boss-dashboard-merge`
- Code HEAD: `86e05a9` (`Declare dashboard COTIK workspace dependency`)
- COTIK normal-sync commits: `7878615`, `c3de274`, `8e2ac8b`
- Navigation/route commits: `edc59e2`, `fb42312`, `62d9e4b`
- Runtime regression fix commits: `77a0cf9` (add `GlobalTaskProvider` boundary), `eb95f38` (remove untracked `FloatingTaskBar` from that fix)
- Dependency fix: `86e05a9` adds the direct Dashboard workspace dependency on `@shop-health/cotik`.
- Existing unrelated WIP remains in the worktree. Do not reset, clean, stash, restore, switch, rebase, merge, or broadly stage it.

## Fresh verification already completed

- `pnpm test` — exit 0; **119 test files passed, 1,080 tests passed**; 19 PostgreSQL/integration files (74 tests) skipped by repository environment conventions.
- `pnpm typecheck` — exit 0; all 10 executed workspace projects completed without errors.
- `pnpm build` — exit 0; packages, CLI, worker, and Dashboard production build completed. Dashboard generated:
  - `/`
  - `/dashboard`
  - `/shops`
  - `/shops/[profileNo]`
  - `/orders`
  - `/settings`
  - `/api/sync/selected`
  - `/api/sync/all-eligible`
  - `/api/sync/cotik`
  - `/api/update-data`
  - `/api/shops`
  - `/api/shops/[profileNo]`
  - **Important:** the build ran against the current worktree. The `/api/shops*` routes are currently untracked local WIP and are not included in code HEAD `62d9e4b`; do not treat them as durable/accepted until separately committed and reviewed.

## Start the Dashboard test server

From `C:\DUY - DoWorks\Tool_TTS-boss-merge`:

```powershell
pnpm --filter @shop-health/dashboard dev
```

Open the standalone Dashboard at:

```text
http://127.0.0.1:3000
```

If port 3000 is occupied:

```powershell
pnpm --filter @shop-health/dashboard dev -- --port 3001
```

Then open `http://127.0.0.1:3001`. Stop the test server with `Ctrl+C`.

This standalone Dashboard server is separate from the DeepSeek Harness GUI at `http://127.0.0.1:3080`.

## Fast route/IA smoke test

Check these routes in order:

1. `/dashboard`
   - Sidebar has only Dashboard, Shops, Settings.
   - Normal actions are labeled `Sync selected (COTIK)` and `Sync all eligible (COTIK)`.
   - These actions remain in place; they must not bounce through Dashboard or open AdsPower.
2. `/shops`
   - Shop directory loads.
   - Primary action is `Sync COTIK (Chính)`.
   - `Sync SC (Fallback)` is visibly secondary and explicit.
3. `/shops/957` (or an actual profile number available in the database)
   - Shop Detail loads.
   - `Order Explorer (...)` links to `/orders?profile=957`.
   - `Sync COTIK (Chính)` is the normal action; AdsPower/Seller Center is fallback only.
4. `/orders?profile=957`
   - Back link returns to `/shops/957`.
   - Profile, period, status, search, and page query values remain preserved while filtering/paging.
5. `/settings`
   - Settings remains an independent top-level workspace.

## COTIK smoke-test prerequisites and expected behavior

Configure runtime values in the local ignored `.env`/process environment only; never paste a token into chat, source, tests, logs, screenshots, or this checkpoint:

- `DATABASE_URL`
- either `COTIK_TOKEN` or `COTIK_API_KEY`
- optional `COTIK_BASE_URL` (defaults to `https://cotik.app/api`)

For a shop with an enabled exact `shop_provider_bindings` COTIK binding:

- Click `Sync COTIK (Chính)` or the Dashboard COTIK normal-sync action.
- Expected normal path: COTIK GET-only ingestion using the exact persisted `providerShopId`; no `listAdsPowerProfiles`, profile launch, CDP connection, Seller Center health check, or Seller Center sync.
- COTIK supplementary Statements/Payments remain `SUPPLEMENTARY_FINANCE`; they must not become Official Finance On Hold.
- A missing token or inactive/missing binding fails closed; it must not silently fall back to AdsPower.

Use `Sync SC (Fallback)` or `Update data (Seller Center)` only when explicitly testing the Seller Center/AdsPower fallback path. Do not use that path to judge the COTIK-primary behavior.

## Current acceptance boundary

- Independent COTIK implementation review: APPROVE after candidate-inventory and lock-sequencing repairs.
- Independent navigation review: APPROVE for the `fb42312` atomicity closure; subsequent `62d9e4b` completion of the same finding was verified directly with the committed route tree and fresh gates, without opening another review under the one-re-review limit.
- Fresh repository test, typecheck, and build gates: PASS as recorded above.
- Live COTIK, PostgreSQL, Seller Center, AdsPower, and browser verification: not run in this session.
- Boss/User screenshot visual approval for the current UI: still required before W20.
- Direct API-key entry in the Settings UI is a separate security-sensitive amendment and is not included in this checkpoint; do not use a real exposed key.

## Issue report format

If a server smoke test fails, record:

- route and exact action;
- HTTP status/response code;
- redacted browser/server error;
- whether AdsPower was unexpectedly opened;
- screenshot with tokens, cookies, PII, and credentials removed.

Keep the worktree WIP intact and do not commit generated artifacts or secrets.
