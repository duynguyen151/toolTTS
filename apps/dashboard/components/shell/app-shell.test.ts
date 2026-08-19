import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppShell } from "./app-shell";

describe("AppShell", () => {
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
});
