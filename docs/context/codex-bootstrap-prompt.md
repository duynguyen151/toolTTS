# Codex Session Bootstrap Prompt

Use this as the short prompt at the start of a new Codex session.

---

Read the project context before doing any implementation.

Required reading, in this order:

1. `docs/context/codex-master-context.md`
2. `docs/context/current-implementation-status.md`
3. `docs/context/ui-dashboard-requirements.md` if the task touches frontend/dashboard/UI
4. every applicable rule/instruction under `.agents`

Then inspect the actual repository and reconcile the documents with the current source.

Rules for this session:

- Repository source is the implementation truth.
- Context files describe product intent and historical decisions.
- If source and context conflict materially, report the conflict before changing architecture.
- Do not rebuild the repo from zero.
- Do not invent TikTok Seller Center selectors/status mappings/API behavior.
- Preserve `packages/domain` as deterministic/pure business logic.
- Keep AI reasoning outside deterministic domain rules.
- Holiday Mode remains `DRY_RUN` unless I explicitly approve otherwise.
- V1 now REQUIRES a dashboard where BA sees metrics + Rule + AI recommendation, makes a decision, and that decision is recorded for V2.
- If a UI reference image is attached, inspect it first and follow `docs/context/ui-dashboard-requirements.md`.
- Use subagents for bounded exploration/review/implementation where useful; avoid multiple writers editing the same area.
- Optimize for correctness, maintainability, simplicity, then performance/scale.
- Do not add frameworks/dependencies without stating the concrete problem they solve and whether ADD/DEFER/REJECT is appropriate.

Before coding, return a concise repo-aware execution plan with:
- current verified state;
- gaps relevant to this task;
- exact files/modules likely affected;
- dependency decision;
- small milestones;
- acceptance criteria;
- unknowns that require live inspection.

Do not produce a generic architecture essay.
Do not repeat all project context back to me.
