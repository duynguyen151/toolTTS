# Agent Resource Sources

Source index: https://viblo.asia/p/github-repos-website-tong-hop-moi-thu-ban-can-de-lam-chu-claude-code-8X4EjbwXJN2

Upstream repositories are shallow-cloned under `.agents/vendor/` and ignored by Git. They are reference material, not automatically active skills.

## Active Codex Skills

The curated project skills in `.agents/skills/` come from:

- `obra/superpowers`: brainstorming, planning, debugging, TDD, review reception, verification.
- `multica-ai/andrej-karpathy-skills`: surgical coding guidelines.
- `addyosmani/agent-skills`: API design, context engineering, code review, incremental implementation, ADRs.
- `adspower/adspower-browser`: project-specific AdsPower operations.
- `supabase/agent-skills`: PostgreSQL best practices, used independently of the Supabase platform.
- `currents-dev/playwright-best-practices-skill`: Playwright and CDP testing guidance.
- `wshobson/agents`: Node.js backend process patterns.
- `mattpocock/skills`: deep-module and codebase design vocabulary.

Claude-specific assumptions were adapted for Codex:

- Use `AGENTS.md`, not `CLAUDE.md`, for project rules.
- Use `.agents/skills/<name>/SKILL.md` for discovery.
- Do not depend on Claude hooks, slash commands, Task/TodoWrite tools, or Claude plugin namespaces.
- Use Codex tools and project commands for verification.
- Do not require subagents unless the user explicitly asks for them.

## Reference-Only Sources

- `affaan-m/ECC` (Everything Claude Code; includes native Codex material)
- `anthropics/skills`
- `mattpocock/skills`
- `coreyhaines31/marketingskills`
- `vercel-labs/agent-skills`
- `eyaltoledano/claude-task-master`
- `VoltAgent/awesome-agent-skills`
- `yamadashy/repomix`
- `hesreallyhim/awesome-claude-code`
- `travisvn/awesome-claude-skills`
- `FlorianBruniaux/claude-code-ultimate-guide`

Install from these into `.agents/skills` only when a concrete project need exists. Avoid bulk activation because duplicate triggers and tool-specific assumptions degrade agent behavior.
