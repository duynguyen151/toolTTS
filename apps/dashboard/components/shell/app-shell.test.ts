import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppShell } from "./app-shell";
import { NavigationList } from "./navigation";
import { ProductMark } from "./sidebar";
import { useGlobalTasks } from "../operations/global-task-context";

describe("AppShell", () => {
  it("provides global task context to route content", () => {
    function TaskContextProbe() {
      const { runningCount } = useGlobalTasks();
      return createElement("span", null, `Running tasks: ${runningCount}`);
    }

    const html = renderToStaticMarkup(
      createElement(AppShell, null, createElement(TaskContextProbe)),
    );

    expect(html).toContain("Running tasks: 0");
  });

  it("renders the dashboard landmark structure and accessible navigation", () => {
    const html = renderToStaticMarkup(
      createElement(
        AppShell,
        null,
        createElement("article", null, "Dashboard content"),
      ),
    );

    expect(html).toContain('href="#main-content"');
    expect(html).toContain("<aside");
    expect(html).toContain('<nav aria-label="Primary navigation"');
    expect(html).toContain('id="sidebar-log-slot"');
    expect(html).toContain("<header");
    expect(html).toContain('<main id="main-content"');
    expect(html).toContain("Dashboard content");
  });

  it("provides a labeled dashboard search control", () => {
    const html = renderToStaticMarkup(createElement(AppShell, null, "Content"));

    expect(html).toContain('aria-label="Search shops and profiles"');
    expect(html).toContain('type="search"');
  });

  it("mounts the light and dark theme control in the application shell", () => {
    const html = renderToStaticMarkup(createElement(AppShell, null, "Content"));

    expect(html).toContain('class="theme-toggle-btn"');
    expect(html).toContain('aria-label="Chuyển sang Giao diện Tối (Dark mode)"');
  });

  it("renders only top-level navigation items (Dashboard, Shops, Settings) without page-internal hash anchors", () => {
    const html = renderToStaticMarkup(createElement(NavigationList));

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/shops"');
    expect(html).toContain('href="/settings"');
    expect(html).not.toContain('/dashboard#decision-trace');
    expect(html).not.toContain('/dashboard#sync-state');
    expect(html).not.toContain('/dashboard#shops');
  });

  it("uses Next.js Link / valid anchors in ProductMark", () => {
    const html = renderToStaticMarkup(createElement(ProductMark));

    expect(html).toContain('href="/dashboard"');
  });
});

