# Tool_TTS V1

Tool_TTS is a backend-first TikTok Shop decision-support system. Deterministic
business facts and Rules remain separate from AI advice and BA decisions; V1
does not automatically change Seller Center business state. COTIK tracking
writes are a separate controlled workflow governed by the dual kill switch and
the safeguards in `AGENTS.md`.

## Current Authority

Read these in order before selecting or accepting work:

1. `AGENTS.md` - operating rules and non-negotiable V1 boundaries.
2. `docs/plans/2026-08-25-tool-tts-v1-master-plan.md` - locked scope, task
   contracts, dependency DAG, and acceptance criteria.
3. `docs/execution/tool-tts-v1-execution-ledger.md` - accepted work and its
   evidence. Code in Git is not acceptance evidence on its own.
4. `docs/execution/tool-tts-v1-codex-handoff.md` - current continuation and
   WIP boundaries.
5. Current Git status, source, tests, and migrations - implementation reality.

The historical `CURRENT_IMPLEMENTATION_STATUS.md`, `CODEX_MASTER_CONTEXT.md`,
and dated plans record earlier decisions and evidence. They do not override the
sources above.

## V1 Boundaries

- Official Finance On Hold is Seller Center Finance evidence; COTIK Finance is
  supplementary only, and Operational Exposure is separate context.
- Authoritative Delivery Rate uses the locked full-population status sets;
  analytical periods do not alter the Rule.
- Rule is deterministic, AI is advisory, and BA is the final authority.
- Decision Cases are immutable and BA revisions are append-only.
- Seller Center execution remains DRY_RUN/no-action. No CAPTCHA bypass, secret
  exposure, browser/session export, or automatic Seller Center writes. COTIK
  tracking POST is permitted only when the controls in `AGENTS.md` hold.
- Business time is `Asia/Bangkok` (GMT+07).

## Development

Requirements: Node.js 22+, pnpm 11+, and PostgreSQL when database-backed work
is being verified.

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm exec drizzle-kit check --config packages/db/drizzle.config.ts
pnpm shop-health doctor --json
```

Use the narrowest relevant package or test command while iterating. Record
unavailable PostgreSQL, AdsPower, Seller Center, COTIK, and AI-provider checks
as environment-pending; never treat them as passes.

The local COTIK API guide at `docs/integrations/cotik/public-api-guide.md` is
intentionally ignored and may contain credentials. Do not stage, print, or copy
it.
