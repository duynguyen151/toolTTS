import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PrimaryButton, SecondaryButton } from "./buttons";
import { InlineLoader } from "./inline-loader";
import { SearchField } from "./search-field";
import { StatusBadge } from "./status-badge";

const tokenCss = readFileSync(
  new URL("../../styles/tokens.css", import.meta.url),
  "utf8",
);

function token(name: string) {
  const match = tokenCss.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) {
    throw new Error(`Missing color token: ${name}`);
  }
  return match[1];
}

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) {
    throw new Error(`Invalid color: ${hex}`);
  }
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("dashboard visual primitives", () => {
  it("keeps shared muted and semantic status text at WCAG AA contrast", () => {
    expect(contrast(token("color-ink-muted"), token("color-shell"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("color-warning"), token("color-warning-soft"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("color-success"), token("color-success-soft"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("color-danger"), token("color-danger-soft"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps primary actions native and exposes busy state", () => {
    const html = renderToStaticMarkup(
      createElement(
        PrimaryButton,
        { loading: true, type: "button" },
        "Update data",
      ),
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
    expect(html).toContain("Update data");
  });

  it("keeps secondary actions native", () => {
    const html = renderToStaticMarkup(
      createElement(SecondaryButton, { type: "button" }, "Dismiss"),
    );

    expect(html).toContain("<button");
    expect(html).toContain("Dismiss");
  });

  it("renders status text instead of relying on color alone", () => {
    const html = renderToStaticMarkup(
      createElement(StatusBadge, {
        children: "Not verified",
        tone: "warning",
      }),
    );

    expect(html).toContain("Not verified");
    expect(html).toContain('data-tone="warning"');
  });

  it("renders a compact loader with an announced label", () => {
    const html = renderToStaticMarkup(
      createElement(InlineLoader, { label: "Updating data" }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Updating data");
  });

  it("renders a visibly labeled search input", () => {
    const html = renderToStaticMarkup(
      createElement(SearchField, { label: "Search shops", name: "shop-search" }),
    );

    expect(html).toContain("Search shops");
    expect(html).toContain('type="search"');
    expect(html).toContain('name="shop-search"');
  });
});
