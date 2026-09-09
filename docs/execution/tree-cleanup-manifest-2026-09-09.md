# Project Tree Cleanup Manifest - 2026-09-09

## Boundary

- Base: `0492070` on `codex/package-completed-wip-2026-09-09`.
- Cleanup branch: `codex/tree-cleanup-2026-09-09`.
- Scope: physical organization only; no business behavior, database schema, migration, Cotik write, or AdsPower behavior changes.
- Recovery: the packaging branch and pre-package stashes remain untouched.
- Rule: use `git mv` for tracked files and update only references made stale by the moves.

## Target tree

```text
apps/
  cli/
  dashboard/
  worker/
packages/
  cotik/
  db/
  decision-ai/
  decision-workflow/
  domain/
  seller-center/
  sync/
scripts/
  gmail/
  tracking/
  ui/
docs/
  context/
  execution/
  integrations/
  plans/
  screenshots/
    baselines/
```

## File decisions

### Keep at repository root

Operational entry points and repository configuration stay at the root:
`AGENTS.md`, `CLAUDE.md`, `README.md`, `.env.example`, `.gitignore`,
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `skills-lock.json`,
`tsconfig.base.json`, and `vitest.config.ts`.

### Move to `docs/context/`

| Current path | Target path | Reason |
| --- | --- | --- |
| `CODEX_BOOTSTRAP_PROMPT.md` | `docs/context/codex-bootstrap-prompt.md` | Session guidance, not a repository entry point |
| `CODEX_MASTER_CONTEXT.md` | `docs/context/codex-master-context.md` | Historical project context |
| `CURRENT_IMPLEMENTATION_STATUS.md` | `docs/context/current-implementation-status.md` | Historical implementation evidence |
| `UI_DASHBOARD_REQUIREMENTS.md` | `docs/context/ui-dashboard-requirements.md` | UI reference context |
| `docs/V1_MASTER_CONTEXT.md` | `docs/context/v1-master-context.md` | Keep all context documents together |
| `output/playwright/dashboard-phase1-final-1440x900.png` | `docs/screenshots/baselines/dashboard-phase1-final-1440x900.png` | Approved visual baseline belongs with documentation evidence, not generated output |

### Move scripts by responsibility

| Current path | Target path | Reason |
| --- | --- | --- |
| `scripts/auto-tracking.mts` | `scripts/tracking/auto-tracking.mts` | Manual auto-tracking v1.0 |
| `scripts/test-cotik-tracking.ps1` | `scripts/tracking/test-cotik-tracking.ps1` | Tracking verification helper |
| `scripts/email-order-extractor.mts` | `scripts/gmail/email-order-extractor.mts` | Gmail extraction |
| `scripts/email-order-extractor.test.ts` | `scripts/gmail/email-order-extractor.test.ts` | Gmail extraction test |
| `scripts/gmail-api-reader.mts` | `scripts/gmail/gmail-api-reader.mts` | Gmail API access |
| `scripts/sync-shein-sheets.mts` | `scripts/gmail/sync-shein-sheets.mts` | Gmail-to-Sheet sync |
| `scripts/exchange-gmail-token.mts` | `scripts/gmail/exchange-gmail-token.mts` | Gmail OAuth utility |
| `scripts/audit-dom-ux.ts` | `scripts/ui/audit-dom-ux.ts` | Dashboard UI audit |
| `scripts/capture-ui-screenshots.ts` | `scripts/ui/capture-ui-screenshots.ts` | Dashboard screenshot capture |

## Deliberately unchanged

- `apps/`, `packages/`, database migrations, and Dashboard route structure.
- `docs/plans/`, `docs/execution/`, `docs/integrations/`, and approved screenshots.
- Ignored local folders such as `.claude/`, `.playwright-mcp/`, `backups/`,
  `output/`, and `node_modules/`; they are not product source. The previously
  tracked baseline under `output/playwright/` is now under `docs/screenshots/`.
- AdsPower/Seller Center code; tree cleanup does not remove a product
  dependency.

## Verification gate

After moves and reference updates:

1. `git diff --check`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build`
5. `pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts`
6. `git status --short --branch`

The structural commit is created only if the moved paths and commands remain
valid. No migration or live Cotik operation is part of this branch.
