# Tool_TTS — V1 Dashboard UI/UX Implementation Specification

## 0. Purpose

This file defines the UI requirements for the V1 dashboard.

The V1 dashboard is a PRODUCT REQUIREMENT, not a cosmetic extra.

It must:
- show shop metrics;
- show deterministic rule output;
- show AI recommendation;
- let BA make a decision;
- record BA decisions;
- support a separate execution confirmation;
- create useful decision data for V2.

When a reference screenshot/image is provided in the task, that image is the primary visual reference.

Do not invent a completely different design system.

---

# 1. User's UI Instruction

Use the following instruction as a binding UI implementation requirement:

> Hãy xây dựng UI giống sát ảnh tham chiếu, sử dụng Heroicons và font Poppins, đồng thời tuân thủ tuyệt đối mọi quy tắc trong thư mục .agent. Viết code bằng Semantic HTML5, ưu tiên các thẻ có ngữ nghĩa và chỉ sử dụng div khi thật sự cần thiết, tránh div soup. Tối ưu cấu trúc HTML theo chuẩn SEO, Accessibility và AI Search (AEO) với heading hierarchy hợp lý, form và hình ảnh đầy đủ ngữ nghĩa, đồng thời giữ DOM gọn gàng, dễ bảo trì, responsive trên mọi thiết bị và bám sát thiết kế về bố cục, khoảng cách, màu sắc, typography và các chi tiết trong ảnh tham chiếu.

Codex must treat:
1. the reference image;
2. this specification;
3. `.agent` rules;
4. actual application requirements

as the UI source of truth.

If they conflict, report the conflict before making a destructive design change.

---

# 2. Visual Fidelity

When a reference screenshot is supplied:

Inspect carefully:
- page frame;
- sidebar/header;
- content width;
- grid;
- card sizes;
- spacing rhythm;
- border radius;
- borders;
- shadows;
- foreground/background colors;
- typography scale;
- font weights;
- icon sizing;
- table density;
- control height;
- empty states;
- status colors;
- mobile behavior.

Aim for close visual reproduction while preserving product functionality.

Do not over-customize unrelated pages.

---

# 3. Typography

Required:

```text
Poppins
```

Use a performant framework-supported font loading method where possible.

Avoid:
- many unrelated font families;
- arbitrary typography values scattered through components.

Prefer shared typography tokens/classes.

---

# 4. Icons

Required icon family:

```text
Heroicons
```

Use icons semantically.

Examples:
- warning;
- status;
- filter;
- search;
- chevron;
- refresh;
- execution;
- history.

Do not mix several icon libraries unless a missing icon creates a real requirement.

---

# 5. Semantic HTML

Prefer:

```html
<header>
<nav>
<main>
<section>
<article>
<aside>
<footer>
<table>
<thead>
<tbody>
<form>
<fieldset>
<legend>
<label>
<button>
<output>
<time>
```

Use `<div>` only where no semantic element expresses the structure.

Avoid div soup.

Do not use clickable `<div>` when `<button>` or `<a>` is correct.

---

# 6. Accessibility

Required:

- sensible heading hierarchy;
- visible keyboard focus;
- full keyboard navigation;
- buttons have accessible names;
- form controls use labels;
- status is not communicated by color alone;
- icon-only buttons have accessible labels;
- table headers use `<th>`;
- modals/dialogs manage focus;
- relevant `aria-*` only where semantic HTML is insufficient;
- sufficient color contrast;
- reduced-motion preference where animation exists.

Do not add ARIA unnecessarily to already semantic elements.

---

# 7. SEO / AEO

This is primarily an authenticated/internal dashboard, so do not over-engineer public SEO.

However:
- use semantic headings;
- sensible page titles/metadata;
- meaningful labels;
- structured page hierarchy;
- concise, explicit text;
- avoid meaningless generic containers.

"AEO" must not justify unnecessary hidden text or duplicated content.

Accessibility and semantic clarity are higher priority than superficial SEO hacks.

---

# 8. Responsive Requirements

Dashboard must work on:

```text
desktop
laptop
tablet
mobile
```

Desktop is the primary BA workflow.

Mobile must remain usable, not necessarily identical.

For wide tables:
- responsive columns;
- horizontal scrolling when justified;
- card/detail alternative for critical mobile data if needed.

Do not destroy desktop information density merely to avoid table scrolling on mobile.

---

# 9. V1 Main Dashboard Information Architecture

Main dashboard should prioritize:

```text
1. shop status/risk overview
2. shops needing BA review
3. latest data freshness
4. rule vs AI disagreement
5. high-exposure shops
```

Suggested top-level page:

```text
<header>
  product title
  sync/freshness state
  global actions if necessary
</header>

<main>
  <section aria-labelledby="summary-heading">
    summary KPI cards
  </section>

  <section aria-labelledby="shops-heading">
    filters/search
    shop review table
  </section>
</main>
```

---

# 10. Main Shop Table

Minimum useful columns:

```text
Shop
Shop Status
Total Orders
Gross/Verified Value
Onhold Value
Delivery Rate
Rule Result
AI Recommendation
AI Confidence
BA Decision
Coverage
Last Sync
```

Do not overcrowd table if the reference design suggests progressive disclosure.

Allow useful filters:

```text
Needs BA Review
High Risk
Rule != AI
AI != BA
Onhold threshold breached
Low AI confidence
Login Required
Challenge Required
```

Use TanStack Table if it reduces implementation burden.

---

# 11. Shop Detail Page

Suggested semantic structure:

```html
<main>
  <header>shop identity + health state</header>

  <section>current metrics</section>

  <section>rule evaluation</section>

  <section>AI recommendation</section>

  <section>BA decision form</section>

  <section>execution state</section>

  <section>history / trend</section>
</main>
```

Show:

### Metrics
- total orders;
- Onhold Value;
- Delivered Count;
- Delivery Rate;
- status counts;
- verified finance values;
- data coverage;
- last sync.

### Rule Result
- decision;
- trigger;
- thresholds;
- exact values used.

### AI Result
- recommendation;
- confidence;
- reason codes;
- concise rationale;
- human review requirement.

### BA Decision
- SCALE;
- CONTINUE;
- WATCH;
- PAUSE;
- reason codes;
- optional note;
- confirm button.

### Execution
Separate from decision.

Current mode:
```text
DRY_RUN
```

---

# 12. BA Decision Form

Use real form semantics.

Example fields:

```text
Decision
Reason Codes
Confidence (optional)
Note (optional)
```

Decision should be visually obvious.

Suggested choices:

```text
SCALE
CONTINUE
WATCH
PAUSE
```

Reason codes should support multiple selection if domain allows.

On submit:
1. validate;
2. create immutable decision snapshot;
3. save BA decision;
4. show saved state;
5. optionally present separate execution confirmation.

Do not perform Holiday Mode just because the BA form was submitted.

---

# 13. Execution Confirmation

If BA chooses an actionable decision:

Display:

```text
Shop
BA decision
Proposed action
Execution mode
Current state
```

Buttons:

```text
Cancel
Confirm & Execute
```

Current V1 execution mode:

```text
DRY_RUN
```

The UI should distinguish:

```text
Decision Saved
vs
Execution Attempted
vs
Execution Successful
```

---

# 14. AI Presentation Rules

AI suggestion must never visually overwrite or hide deterministic rule result.

Show them independently:

```text
Rule
AI
BA
Execution
```

AI confidence should be visible.

If AI output is invalid/unavailable:

```text
AI UNAVAILABLE
```

Do not fabricate recommendation.

If AI requires human review, make it explicit.

---

# 15. Data Coverage Presentation

Coverage is important.

Possible:

```text
COMPLETE
PARTIAL
UNKNOWN
```

When unknown, show a tooltip/explanation:

> Metrics use all historical records currently available in the local database; complete lifetime coverage has not yet been verified.

Do not label it "Lifetime" unless proven.

---

# 16. V1 UI Technology Preferences

Preferred:

```text
Next.js
React
TypeScript
Poppins
Heroicons
shadcn/ui for selected primitives
TanStack Table for review tables
Recharts only for verified useful trends
```

Do not clone entire external repositories.

Use packages/components selectively.

Do not add Refine unless current UI scope clearly benefits from its CRUD/admin abstractions.

---

# 17. DOM / Component Discipline

Components should correspond to meaningful product units.

Examples:

```text
ShopSummaryCard
RiskResultPanel
AiRecommendationPanel
BaDecisionForm
ExecutionPanel
CoverageBadge
ShopReviewTable
```

Avoid arbitrary decomposition into tiny wrapper components with no behavior/semantic purpose.

Avoid huge components containing:
- fetch;
- transformations;
- business calculations;
- rendering;
- mutation

all together.

Business formulas stay in domain/backend.

UI consumes prepared data.

---

# 18. UI State Requirements

Explicit states:

```text
loading
empty
partial data
stale data
syncing
error
AI unavailable
login required
challenge required
decision saved
execution dry run
execution failed
```

Do not use generic blank screens.

---

# 19. Reference Image Workflow for Codex

When the user attaches the dashboard reference image:

1. inspect the image before coding;
2. map visible regions to semantic components;
3. identify design tokens;
4. compare with existing app structure;
5. implement the smallest structure that reproduces the design;
6. run the app;
7. visually inspect rendered result where tools allow;
8. iterate on:
   - spacing;
   - dimensions;
   - typography;
   - borders;
   - colors;
   - table density;
   - responsive behavior.

Do not declare "matches reference" without checking the rendered result when local preview/browser tooling is available.

---

# 20. UI Definition of Done

A dashboard milestone is DONE only when:

- page renders;
- no TypeScript/build errors;
- reference-image layout is substantially reproduced;
- semantic structure is reasonable;
- keyboard interaction works for primary actions;
- desktop works;
- mobile/tablet remain usable;
- BA can complete intended workflow;
- no metric/business logic was duplicated in UI;
- no fake values/selectors/business states were invented.
