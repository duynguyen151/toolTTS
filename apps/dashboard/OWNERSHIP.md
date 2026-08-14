# Phase 1 Ownership

Shared contracts are maintainer-owned and locked during parallel implementation:

- `styles/tokens.css`
- `lib/dashboard-contract.ts`
- root dependency files and lockfile

Writer boundaries:

- Coder 1: `app/layout.tsx`, `app/globals.css`, `components/shell/**`, `components/ui/**`
- Coder 2: `lib/dashboard-model.ts`, `lib/dashboard-read.ts`, and tests under `lib/**`
- Coder 3: `app/page.tsx`, `components/dashboard/**`

Cross-area changes must be reported to the maintainer. Writers must not edit another owner's files.

Required integration seam:

```ts
export function buildDashboardPresentation(source: DashboardSource): DashboardPresentation;
export function loadDashboardPresentation(): Promise<DashboardPresentation>;
```

Visual rules:

- Import and use `styles/tokens.css`; do not introduce a parallel palette, radius, or shadow system.
- Poppins and Heroicons are mandatory.
- Keep Rule, AI, BA review, and Execution as separate stages.
- Unknown or unavailable data remains explicit and is never converted to zero.
- No charts, gradients, glassmorphism, decorative animation, or default shadcn visuals in Phase 1.

## Phase 2 Checkpoint A Ownership

Shared interfaces remain maintainer-owned:

- `lib/operations-contract.ts`
- `styles/tokens.css`
- `components/ui/**`
- existing Phase 1 dashboard composition and shell files
- root dependency files and lockfile

Checkpoint A writer boundaries:

- Coder 1: `packages/seller-center/src/adspower/**`, `lib/server/operations/**`, and `app/api/profiles/**` / `app/api/update-data/**`
- Maintainer: `components/operations/**`, integration edits to existing dashboard files, package integration, live server, and final merge
- Reviewer: read-only technical, privacy, accessibility, scope, and 1440x900 visual review

Client-visible operations data uses `profileNo` only. AdsPower internal IDs, CDP endpoints, cookies, sessions, credentials, and proxy details must remain behind the server seam.
