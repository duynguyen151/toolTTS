# Tool_TTS

Tool_TTS is a backend-first TypeScript monorepo for TikTok Shop health
collection, deterministic risk evaluation, COTIK synchronization, controlled
tracking updates, and a V1 operations dashboard.

The system keeps deterministic business rules, AI advice, human BA decisions,
and external writes as separate layers. AI is advisory only. Seller Center
execution remains dry-run/no-action. COTIK tracking writes are available only
through explicit safety controls.

## Current scope

- **Shop health and decision support** — collect normalized shop data, persist
  evidence, calculate deterministic metrics, evaluate risk rules, and record
  BA decisions.
- **COTIK integration** — multi-account discovery, order synchronization,
  explicit provider catalog matching, tracking staging, controlled POST, and
  readback.
- **Auto-tracking v1.0** — read eligible rows from Google Sheets, resolve the
  logical shop from Sheet data, stage tracking intents, run the controlled
  COTIK worker once, and write terminal results back to blank result cells.
  Manual execution is complete; scheduled auto-tracking is future scope.
- **Gmail → Sheet pipeline** — extract order and tracking data from Gmail and
  update the Sheet used by auto-tracking. This is an independent function with
  its own commands and schedule.
- **V1 Dashboard** — view shops, orders, metrics, settings, COTIK controls,
  operational states, Rule output, AI advisory output, and BA workflow data.

## Architecture

```text
AdsPower / Seller Center ─┐
                           ├─> extraction and normalization ─> sync and DB
COTIK --------------------┘                                  │
                                                              ├─> domain rules
Gmail ─> tracking extraction ─> Google Sheets ─> auto-tracking ─┘

CLI / worker / Dashboard <─ explicit read contracts and controlled workflows
```

The main boundaries are:

- `packages/domain` contains pure contracts, metrics, recommendations, and
  deterministic risk policy.
- `packages/db` contains PostgreSQL/Drizzle schema, migrations, queries, and
  locks.
- `packages/seller-center` contains AdsPower/CDP collection and normalization.
- `packages/cotik` contains COTIK transport, discovery, provider matching, and
  tracking write/readback logic.
- `packages/sync` contains synchronization orchestration and persistence
  boundaries.
- `apps/cli`, `apps/worker`, and `apps/dashboard` provide the operational
  interfaces.

## Safety model

The following rules are part of the product boundary, not optional guidance:

- AI never decides risk, changes deterministic rules, enables a kill switch, or
  triggers a COTIK write.
- Seller Center actions remain `DRY_RUN`; the project does not automate price,
  stock, promotion, listing, or Holiday Mode mutations.
- A COTIK tracking POST requires explicit human enablement of
  `cotikPostEnabled`, a valid sync/workflow state, a matched provider rule,
  fingerprinted intent, readback confirmation, at most three attempts per
  intent, and at most 50 orders per batch.
- Kill switches default to OFF and reset to OFF on deployment changes.
- Unknown carrier, order status, shop identity, region, or incomplete evidence
  fails closed or becomes paused; the system does not guess.
- Cookies, OAuth tokens, browser state, buyer data, contact details, shipping
  addresses, and database backups must never enter Git.

## Repository layout

```text
apps/
  cli/                 Commander CLI
  dashboard/           Next.js dashboard
  worker/              Polling and COTIK worker cycles

packages/
  cotik/               COTIK client and tracking workflows
  db/                  PostgreSQL, Drizzle, migrations, queries
  decision-ai/         Advisory AI provider boundary
  decision-workflow/   Decision orchestration and persistence contracts
  domain/              Pure business contracts and deterministic rules
  seller-center/       AdsPower/CDP collection and normalization
  sync/                Synchronization orchestration

scripts/
  gmail/               Gmail extraction and Sheet synchronization
  tracking/            Auto-tracking and tracking verification helpers
  ui/                  Dashboard UI audit and screenshot tools

docs/
  context/             Historical and session context
  execution/           Acceptance evidence and operational contracts
  plans/               Implementation plans and ADRs
  screenshots/         Approved UI evidence and baselines
```

## Requirements

- Node.js 22 or newer
- pnpm 11
- PostgreSQL for database-backed development and migrations
- Google OAuth credentials for the Gmail → Sheet pipeline
- AdsPower Local API when using Seller Center/profile collection workflows
- COTIK credentials and provider configuration for COTIK workflows

The repository is currently configured as a pnpm workspace. Install the
dependencies from the repository root:

```powershell
corepack enable
pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

Update `.env` with local values before running database-backed commands. Keep
`.env` private. `TEST_DATABASE_URL` is intended for an isolated test database;
do not point destructive integration tests at a production Supabase database.

## Common commands

### Quality gates

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts
```

### Applications

```powershell
pnpm dashboard
pnpm shop-health -- --help
pnpm worker
```

### Database

```powershell
pnpm db:generate
pnpm db:migrate
pnpm db:seed:demo
```

Review the migration and database safety rules before running `pnpm db:migrate`.

### Auto-tracking

The stable capability reads one JSON request from stdin and writes one JSON
response to stdout:

```powershell
pnpm auto-tracking
```

Example request:

```json
{"action":"execute","input":{"spreadsheetId":"<id>","tab":"Tháng 9-US","range":"A1:AC2000","region":"US","fromDate":"2026-09-04"}}
```

Supported actions are `status`, `execute`, and `stop`. `stage-sheet-date` and
the capability do not accept `--shop-id`; the Sheet account/shop value is used
to resolve the logical shop. `stop` disables both COTIK switches.

The equivalent CLI command is available when explicit options are preferable:

```powershell
pnpm shop-health -- cotik-tracking capability `
  --action execute `
  --spreadsheet-id <id> `
  --tab "Tháng 9-US" `
  --range A1:AC2000 `
  --region US `
  --from-date 2026-09-04
```

The lower-level manual command for one logical shop remains available for
diagnostics:

```powershell
pnpm shop-health -- cotik-tracking stage `
  --shop-id <logical-shop-id> `
  --order-id <cotik-order-id> `
  --tracking <tracking-number> `
  --provider <provider-name> `
  --region US
```

### Gmail → Sheet

```powershell
pnpm sync:shein-sheets
pnpm sync:shein-sheets:schedule
pnpm sync:shein-sheets --status-only
pnpm sync:shein-sheets --status-only --dry-run
```

The Gmail pipeline supplies Sheet data. It does not perform the COTIK tracking
POST itself, and it is independent from the auto-tracking schedule.

## Testing notes

Run the narrowest relevant test while iterating, then run the full quality
gates before accepting a change. The test suite includes unit, contract,
migration, Dashboard, and database integration tests.

When `TEST_DATABASE_URL` is not configured, database integration tests skip by
design rather than writing to the configured runtime database. A skipped test
is not a passed integration test; run those tests only with an isolated test
database.

The current local baseline is:

- `149` test files passed
- `1301` tests passed
- `18` database integration files skipped when no isolated test database is
  configured

## Documentation

- [`AGENTS.md`](AGENTS.md) — non-negotiable architecture and safety rules.
- [`V1 master plan`](docs/plans/2026-08-25-tool-tts-v1-master-plan.md) — locked
  scope and acceptance criteria.
- [`Execution ledger`](docs/execution/tool-tts-v1-execution-ledger.md) —
  accepted work and evidence.
- [`Auto-tracking capability`](docs/execution/auto-tracking-capability.md) —
  Sheet-to-COTIK contract.
- [`W21 acceptance`](docs/execution/w21-tracking-acceptance-2026-09-07.md) —
  COTIK tracking acceptance and operational boundary.
- [`Tree cleanup manifest`](docs/execution/tree-cleanup-manifest-2026-09-09.md)
  — current project organization decisions.

## Contribution rules

1. Read `AGENTS.md` and the relevant execution or plan document.
2. Keep domain logic independent from browser, database, UI, and AI provider
   implementations.
3. Make the smallest focused change; do not stage with `git add .`.
4. Add or update the narrowest relevant test for behavior changes.
5. Run typecheck, tests, build, and schema checks before claiming completion.
6. Never commit `.env`, OAuth material, tokens, cookies, browser state, or
   database backups.

The project does not currently include a license file. Add one only when the
repository owner explicitly selects the license terms.
