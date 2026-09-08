import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GlobalTaskProvider } from "./global-task-context";
import { FloatingTaskBar } from "./floating-task-bar";

const styles = readFileSync(
  new URL("./floating-task-bar.module.css", import.meta.url),
  "utf8",
);

describe("FloatingTaskBar layout", () => {
  it("keeps a compact control available before any background task starts", () => {
    const html = renderToStaticMarkup(
      createElement(GlobalTaskProvider, null, createElement(FloatingTaskBar)),
    );

    expect(html).toContain('aria-label="Mở thanh tác vụ nền"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("stays anchored to the viewport and reserves the bottom safe area", () => {
    expect(styles).toMatch(/\.floatingContainer\s*\{[\s\S]*position:\s*fixed/);
    expect(styles).toMatch(/\.floatingContainer\s*\{[\s\S]*inset-block-end:\s*calc\(/);
    expect(styles).toContain("env(safe-area-inset-bottom,");
  });
});
