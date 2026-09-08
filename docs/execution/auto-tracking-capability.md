# Auto-tracking capability

`auto_tracking` is the stable boundary for Hermes. It wraps the existing Sheet → stage → Cotik worker → readback workflow; it does not implement a second POST path.

## Contract

- Schema: `auto-tracking-capability.v1`
- Actions: `status`, `execute`, `stop`
- Region: `US` only
- Input transport: one JSON object on stdin
- Output transport: one JSON object on stdout

Run it with:

```text
pnpm auto-tracking
```

Example request:

```json
{"action":"execute","input":{"spreadsheetId":"<id>","tab":"Tháng 9-US","range":"A1:AC2000","region":"US","fromDate":"2026-09-04"}}
```

`stage-sheet-date` does not accept `--shop-id`. It reads the account/shop value
from the Sheet and resolves it to the matching logical shop before staging.

`execute` performs the existing operations in order:

1. Read eligible Sheet rows and stage candidates/intents.
2. Run `runCotikWorkerCycle` once with discovery and order GET skipped.
3. Read back Cotik and write only blank result cells in column W.

The worker remains authoritative for kill-switch checks, advisory lock, reservation, retry/recovery, provider validation, POST pacing, and readback. `execute` never enables either switch. `stop` sets both switches to `false`.

Hermes should map user intent, not exact wording:

- “check tracking status” → `status`
- “run/add/push/continue tracking” → `execute` with the known Sheet input
- “stop/pause tracking” → `stop`

Natural-language interpretation stays outside this contract. Hermes must not infer a provider, invent Sheet IDs, or enable POST implicitly. Explicit POST enablement remains a separate human-approved operation through the existing kill-switch command.
