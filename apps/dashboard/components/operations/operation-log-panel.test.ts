import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OperationLogEntry } from "./operation-log.js";
import { OperationLogPanel } from "./operation-log-panel.js";

const entries: readonly OperationLogEntry[] = [{
  timestamp: "2026-08-17T09:00:00.000Z",
  level: "error",
  state: "ERROR",
  message: "The selected profile proxy did not respond.",
}];

describe("OperationLogPanel", () => {
  it("renders an accessible realtime log drawer with safe log controls", () => {
    const html = renderToStaticMarkup(createElement(OperationLogPanel, {
      entries,
      onClear: () => undefined,
      onClose: () => undefined,
      open: true,
    }));

    expect(html).toContain('aria-label="Realtime tool log"');
    expect(html).toContain("The selected profile proxy did not respond.");
    expect(html).toContain("Clear");
    expect(html).toContain("Download JSON");
    expect(html).toContain("Download .log");
  });
});
