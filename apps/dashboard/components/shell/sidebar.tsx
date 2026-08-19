import { ChartBarSquareIcon } from "@heroicons/react/24/solid";

import { NavigationList } from "./navigation";

export function ProductMark() {
  return (
    <a className="product-mark" href="/dashboard" aria-label="Tool TTS dashboard">
      <span className="product-mark__icon" aria-hidden="true">
        <ChartBarSquareIcon />
      </span>
      <span>
        <strong>Tool TTS</strong>
        <small>Shop health</small>
      </span>
    </a>
  );
}

export function Sidebar() {
  return (
    <aside className="sidebar">
      <ProductMark />
      <NavigationList />
      <div className="sidebar-log-slot" id="sidebar-log-slot" />
      <section className="sidebar-note" aria-labelledby="sidebar-note-title">
        <span className="sidebar-note__eyebrow">Decision trail</span>
        <h2 id="sidebar-note-title">Auditable by design</h2>
        <p>Rule, AI, BA and execution stay separate.</p>
      </section>
    </aside>
  );
}
