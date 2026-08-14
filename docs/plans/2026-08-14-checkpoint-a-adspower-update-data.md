# Checkpoint A AdsPower and Update Data Implementation Plan

> **For Codex:** Implement this plan task-by-task in the current session with bounded subagents as explicitly requested by the user. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/dashboard` safely list and open AdsPower profiles and run the existing Orders + Finance synchronization workflow with truthful streamed states.

**Architecture:** Extend the existing `AdsPowerClient` with privacy-safe profile listing and ready-wait behavior. A server-only dashboard operations module composes that client with the existing database, Seller Center source, `runShopSync`, and deterministic risk evaluation. Local-only Next.js route handlers expose sanitized JSON/NDJSON contracts to a small client-side operations provider; no browser connection, credential, cookie, proxy, or session detail crosses the server seam.

**Tech Stack:** TypeScript, Next.js 16 App Router Route Handlers, React 19, existing workspace packages, Vitest, Playwright.

**Spec:** `C:/Users/PC/.codex/attachments/8504532e-8c44-4f8f-bb81-2192975c2f4e/goal-objective.md`

## Global Constraints

- Preserve the accepted Phase 1 visual baseline and screenshot `output/playwright/dashboard-phase1-final-1440x900.png`.
- Reuse existing Seller Center extraction and `@shop-health/sync`; do not rewrite collectors, pagination, reconciliation, risk rules, or AI.
- Client-visible data must not contain AdsPower `user_id`, CDP/WebSocket/debug endpoints, API keys, cookies, sessions, proxies, usernames, passwords, or raw profile names.
- UI states are exactly truthful: `READY`, `OPENING_PROFILE`, `CONNECTING`, `SYNCING_ORDERS`, `SYNCING_FINANCE`, `RECONCILING`, `SUCCESS`, `PARTIAL`, `ERROR`, `LOGIN_REQUIRED`, `SECURITY_CHECK_REQUIRED`.
- No fake progress percentages. Holiday Mode remains DRY_RUN and is not part of Checkpoint A.
- Route handlers accept only local requests and validate profile numbers at the request seam.
- Stop for live visual, technical, privacy, and scope review after Checkpoint A.

---

### Task 1: Extend the Existing AdsPower Module

**Files:**
- Modify: `packages/seller-center/src/adspower/client.ts`
- Modify: `packages/seller-center/src/adspower/client.test.ts`
- Modify: `packages/seller-center/src/index.ts`

**Interfaces:**
- Produces: `AdsPowerProfileSummary`, `AdsPowerProfileState`, `AdsPowerClient.listProfiles()`, `AdsPowerClient.getProfileState(profileId)`, and `AdsPowerClient.openReady(profileId, options)`.
- Invariant: Only `profileId`, `profileNo`, state, and optional group name exist in server-side summaries; raw names and credential-bearing fields are discarded during schema parsing.

- [ ] **Step 1: Write failing tests for privacy-safe profile listing**

  Add a mocked `/api/v1/user/list` response containing `password`, `username`, `user_proxy_config`, and `name`, plus a mocked `/api/v1/browser/local-active` response. Assert the returned summaries contain only `profileId`, `profileNo`, `groupName`, and `state`, and that active profiles are `OPEN` while the others are `CLOSED`.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `pnpm exec vitest run packages/seller-center/src/adspower/client.test.ts`

  Expected: FAIL because `listProfiles` and the new profile types do not exist.

- [ ] **Step 3: Implement strict response schemas and pagination**

  Use `page_size=200`; continue while a page returns exactly 200 items. Parse list items with a stripping Zod schema that selects only `user_id`, `serial_number`, and `group_name`. Parse the active-list endpoint separately and map its IDs to `OPEN`; map remaining profiles to `CLOSED`; use `ERROR` only when active state cannot be verified.

- [ ] **Step 4: Write failing tests for ready wait**

  Test an inactive profile whose start response does not yet contain a WebSocket endpoint, then two active polls where the second becomes ready. Test timeout mapping without real timers longer than the test budget.

- [ ] **Step 5: Run the focused test and verify RED**

  Run: `pnpm exec vitest run packages/seller-center/src/adspower/client.test.ts`

  Expected: FAIL because `openReady` does not exist.

- [ ] **Step 6: Implement `getProfileState` and `openReady`**

  Keep the existing `active` and `open` behavior compatible. `openReady` starts only when closed, polls `active`, returns the server-only connection when ready, and throws a typed `SellerCenterError` when start fails or the ready deadline expires.

- [ ] **Step 7: Verify seller-center tests and typecheck**

  Run: `pnpm exec vitest run packages/seller-center/src/adspower/client.test.ts`

  Run: `pnpm --filter @shop-health/seller-center typecheck`

- [ ] **Step 8: Commit the AdsPower module increment**

  Run: `git add packages/seller-center/src/adspower && git add packages/seller-center/src/index.ts && git commit -m "feat: expose safe AdsPower profile operations"`

---

### Task 2: Define the Client-Safe Operations Contract

**Files:**
- Create: `apps/dashboard/lib/operations-contract.ts`
- Create: `apps/dashboard/lib/operations-contract.test.ts`
- Modify: `apps/dashboard/OWNERSHIP.md`

**Interfaces:**
- Produces: `DashboardProfile`, `ProfileOperationsPresentation`, `OpenProfileResult`, `UpdateDataEvent`, `UpdateDataState`, `OperationErrorCode`, and `isTerminalUpdateState(state)`.
- Client identifier: `profileNo` only. AdsPower `profileId` is intentionally absent.

- [ ] **Step 1: Write a failing contract test**

  Assert that `isTerminalUpdateState` returns true only for `SUCCESS`, `PARTIAL`, `ERROR`, `LOGIN_REQUIRED`, and `SECURITY_CHECK_REQUIRED`; assert serialized fixture objects do not contain forbidden keys such as `profileId`, `cdpEndpoint`, `cookie`, `proxy`, `username`, or `password`.

- [ ] **Step 2: Run the contract test and verify RED**

  Run: `pnpm exec vitest run apps/dashboard/lib/operations-contract.test.ts`

  Expected: FAIL because the contract module does not exist.

- [ ] **Step 3: Implement the discriminated contracts**

  Define profile states `OPEN | CLOSED | ERROR`, link states `LINKED | UNLINKED | UNKNOWN`, and update events shaped as `{ state, message, terminal, completedKinds }`. Terminal error events include only allowlisted `code` and operator-facing `message`.

- [ ] **Step 4: Record non-overlapping Phase 2 ownership**

  Coder 1 owns `packages/seller-center/src/adspower/**`, `apps/dashboard/lib/server/operations/**`, and Checkpoint A route handlers. Maintainer owns shared contracts, package integration, existing dashboard composition files, and lockfiles. Reviewer remains read-only.

- [ ] **Step 5: Verify contract tests and dashboard typecheck**

  Run: `pnpm exec vitest run apps/dashboard/lib/operations-contract.test.ts`

  Run: `pnpm --filter @shop-health/dashboard typecheck`

---

### Task 3: Build the Server-Only Operations Module

**Files:**
- Create: `apps/dashboard/lib/server/operations/dashboard-operations.ts`
- Create: `apps/dashboard/lib/server/operations/dashboard-operations.test.ts`
- Create: `apps/dashboard/lib/server/operations/runtime.ts`
- Modify: `apps/dashboard/package.json`
- Modify: `apps/dashboard/next.config.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `AdsPowerClient`, `createSellerCenterDataSource`, `runShopSync`, `evaluateAndStoreRiskControl`, and database shop queries.
- Produces: `DashboardOperations.listProfiles(selectedProfileNo?)`, `openProfile(profileNo)`, and `updateData(profileNo, emit)`.

- [ ] **Step 1: Write failing orchestration tests with injected adapters**

  Cover: all AdsPower profiles are returned; linked shop state is joined by server-only profile ID; unlinked profiles can be opened; unlinked profiles cannot run Update Data; closed linked profiles are opened before sync; orders run before finance; risk evaluation runs after both; each expected state is emitted in order.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `pnpm exec vitest run apps/dashboard/lib/server/operations/dashboard-operations.test.ts`

  Expected: FAIL because the operations module does not exist.

- [ ] **Step 3: Implement the injected deep module**

  Keep one public interface with three methods. Create and close database contexts inside the runtime adapter. The core module accepts injected adapters so unit tests cross the same seam as route handlers.

- [ ] **Step 4: Add truthful error mapping tests**

  Cover `LOGIN_REQUIRED`, `CHALLENGE_REQUIRED`, AdsPower unavailable, profile start failure, layout change after orders, an advisory-lock skip, and a risk-evaluation failure after successful syncs. Assert partial completed kinds remain explicit.

- [ ] **Step 5: Run the focused test and verify RED**

  Run: `pnpm exec vitest run apps/dashboard/lib/server/operations/dashboard-operations.test.ts`

  Expected: FAIL for the newly added mappings before implementation.

- [ ] **Step 6: Implement allowlisted operational results**

  Map login to `LOGIN_REQUIRED`, challenge to `SECURITY_CHECK_REQUIRED`, a later-stage failure with completed work to `PARTIAL`, and other failures to `ERROR`. Never forward raw CDP endpoints or third-party response bodies.

- [ ] **Step 7: Integrate workspace packages without unrelated upgrades**

  Add only `@shop-health/seller-center` and `@shop-health/sync` as dashboard workspace dependencies. Add them to `transpilePackages`. Regenerate the lockfile through `pnpm install`; do not hand-edit it.

- [ ] **Step 8: Verify the server module and builds**

  Run: `pnpm exec vitest run apps/dashboard/lib/server/operations`

  Run: `pnpm --filter @shop-health/dashboard typecheck`

  Run: `$env:NEXT_DIST_DIR='.next-checkpoint-a'; pnpm --filter @shop-health/dashboard build`

---

### Task 4: Add Local-Only Route Handlers

**Files:**
- Create: `apps/dashboard/app/api/profiles/open/route.ts`
- Create: `apps/dashboard/app/api/profiles/open/route.test.ts`
- Create: `apps/dashboard/app/api/update-data/route.ts`
- Create: `apps/dashboard/app/api/update-data/route.test.ts`
- Create: `apps/dashboard/lib/server/operations/request.ts`

**Interfaces:**
- `POST /api/profiles/open` consumes `{ profileNo }` and returns `OpenProfileResult`.
- `POST /api/update-data` consumes `{ profileNo }` and streams newline-delimited `UpdateDataEvent` objects.

- [ ] **Step 1: Write failing request-seam tests**

  Cover invalid JSON, invalid profile number, non-local host, mismatched non-local origin, and a valid local request. Assert the operations module is not invoked for rejected requests.

- [ ] **Step 2: Run route tests and verify RED**

  Run: `pnpm exec vitest run apps/dashboard/app/api/profiles/open/route.test.ts apps/dashboard/app/api/update-data/route.test.ts`

  Expected: FAIL because the route handlers do not exist.

- [ ] **Step 3: Implement local request validation and open route**

  Permit `127.0.0.1`, `localhost`, and `::1`; validate `profileNo` against `^[A-Za-z0-9_-]{1,64}$`; return consistent JSON errors without stack traces.

- [ ] **Step 4: Implement NDJSON streaming**

  Emit each state as one JSON line. Set `Content-Type: application/x-ndjson; charset=utf-8`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and close the stream after exactly one terminal event.

- [ ] **Step 5: Verify route tests and dashboard typecheck**

  Run: `pnpm exec vitest run apps/dashboard/app/api/profiles/open/route.test.ts apps/dashboard/app/api/update-data/route.test.ts`

  Run: `pnpm --filter @shop-health/dashboard typecheck`

---

### Task 5: Add the Dashboard Operations Client Island

**Files:**
- Create: `apps/dashboard/components/operations/operations-provider.tsx`
- Create: `apps/dashboard/components/operations/operations-controls.tsx`
- Create: `apps/dashboard/components/operations/profile-operation-state.tsx`
- Create: `apps/dashboard/components/operations/operations.module.css`
- Create: `apps/dashboard/components/operations/operations.test.ts`
- Create: `apps/dashboard/lib/read-update-stream.ts`
- Create: `apps/dashboard/lib/read-update-stream.test.ts`
- Modify: `apps/dashboard/components/dashboard/dashboard-overview.tsx`
- Modify: `apps/dashboard/components/dashboard/operational-panel.tsx`
- Modify: `apps/dashboard/components/dashboard/dashboard-overview.module.css`
- Modify: `apps/dashboard/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `ProfileOperationsPresentation`, open JSON results, and update NDJSON events.
- Produces: a shared selected-profile state used by compact header controls and the AdsPower state row.

- [ ] **Step 1: Write failing stream-parser tests**

  Cover JSON lines split across arbitrary chunks, multiple events in one chunk, a final line without trailing newline, and malformed JSON producing a controlled error.

- [ ] **Step 2: Run parser tests and verify RED**

  Run: `pnpm exec vitest run apps/dashboard/lib/read-update-stream.test.ts`

  Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement the smallest async NDJSON parser**

  Decode chunks incrementally, retain the unfinished tail, parse complete lines, and yield typed events. Do not buffer the full update response.

- [ ] **Step 4: Write failing rendered-component tests**

  Assert all profiles appear in a labeled native select, link state is textual, Update Data is disabled for unlinked/unknown profiles, Open Profile remains available for a valid AdsPower profile, state changes have an `aria-live` region, and no fake percentage is rendered.

- [ ] **Step 5: Run component tests and verify RED**

  Run: `pnpm exec vitest run apps/dashboard/components/operations/operations.test.ts`

  Expected: FAIL because the operations components do not exist.

- [ ] **Step 6: Implement the provider and visual controls**

  Reuse existing buttons, inline loader, status badge, tokens, Poppins, and Heroicons. Keep the profile selector and primary action compact. Preserve white-dominant surfaces and the accepted dashboard proportions.

- [ ] **Step 7: Integrate the client island into `/dashboard`**

  Load dashboard and profile presentations in parallel. Wrap the dashboard in `OperationsProvider`; replace the disabled Phase 1 actions and `NOT_VERIFIED` AdsPower row with live operation controls without changing unrelated KPI or Decision Trace grammar.

- [ ] **Step 8: Verify component tests, typecheck, and HMR**

  Run: `pnpm exec vitest run apps/dashboard/components/operations apps/dashboard/lib/read-update-stream.test.ts apps/dashboard/components/dashboard/dashboard-overview.test.ts`

  Run: `pnpm --filter @shop-health/dashboard typecheck`

  Confirm `http://127.0.0.1:3000/dashboard` updates through HMR without restarting the dev server.

---

### Task 6: Checkpoint A End-to-End Review

**Files:**
- Create: `output/playwright/dashboard-checkpoint-a-1440x900.png`
- Modify only files assigned by reviewer findings.

**Interfaces:**
- End-to-end operator flow: select profile -> inspect OPEN/CLOSED/link state -> open profile -> run Update Data for a linked shop -> see truthful terminal state -> refreshed dashboard data.

- [ ] **Step 1: Run privacy-safe live profile listing**

  Verify the UI includes all AdsPower profile numbers but does not render raw AdsPower names, internal IDs, credentials, proxy fields, or CDP details.

- [ ] **Step 2: Verify closed-profile open behavior**

  Use a configured test profile only when safe. Confirm UI states progress from `OPENING PROFILE` to `READY`, and the profile remains available for manual login/security handling.

- [ ] **Step 3: Verify Update Data states without fake progress**

  Confirm the network response arrives as NDJSON states and the UI displays actual stages. Do not perform any Seller Center write.

- [ ] **Step 4: Run focused and full technical validation**

  Run: `pnpm typecheck`

  Run: `pnpm test`

  Run: `$env:NEXT_DIST_DIR='.next-checkpoint-a'; pnpm build`

- [ ] **Step 5: Capture and review 1440x900**

  Compare against `output/playwright/dashboard-phase1-final-1440x900.png` for shell, spacing, density, typography, radius, shadows, KPI language, Decision Trace grammar, and anti-AI gate.

- [ ] **Step 6: Run read-only reviewer**

  Reviewer reports findings with severity, file/component, owner, and acceptance criterion. Route privacy, local-only enforcement, truthful unknown/error states, responsive behavior, and scope creep are mandatory checks.

- [ ] **Step 7: Fix by ownership and re-review until APPROVE**

  Stop after Checkpoint A approval. Do not start `/shops` or `/reviews` in the same checkpoint turn.
