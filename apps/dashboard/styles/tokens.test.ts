import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

describe("dashboard theme tokens", () => {
  it("defines a dark theme token set alongside the light defaults", () => {
    expect(tokens).toContain('[data-theme="dark"]');
    expect(tokens).toContain("html.dark");
    expect(tokens).toContain("--color-canvas: #0b0f19");
    expect(tokens).toContain("--color-surface: #1f293d");
  });
});
