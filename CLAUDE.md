# Claude Code Project Bridge

This repository is governed by `AGENTS.md`. Read it before making changes; it
contains the project authority order, locked product semantics, architecture,
verification gates, and WIP boundaries. This file is intentionally only a
Claude Code discovery bridge and does not duplicate that guide.

## Authority

- Locked Master Plan: `docs/plans/2026-08-25-tool-tts-v1-master-plan.md`
- Accepted work and evidence: `docs/execution/tool-tts-v1-execution-ledger.md`
- Continuation state: `docs/execution/tool-tts-v1-codex-handoff.md`
- Current implementation reality: current Git state
- Project operating guidance: `AGENTS.md`

Project-specific decisions, specifications, ledgers, handoffs, and scripts
take precedence over generic plugin or skill guidance. Do not overwrite them
or modify production source merely to configure the harness.

## Skills

`.agents/skills` is the canonical project-local skill catalog. The
`.claude/skills` path is a Claude Code discovery projection of that catalog;
keep the two locations as one source, not two installations. Load only the
skill relevant to the current task and preserve project-specific guidance.

## Harness

Claude Code native is the top-level orchestrator. Use the configured native
plan/execution routing and the independent reviewer for meaningful changes.
External plugins are complementary and must not override project authority,
model routing, provider configuration, or review policy.
