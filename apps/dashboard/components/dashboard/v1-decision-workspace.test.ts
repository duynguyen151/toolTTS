import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { V1DecisionWorkspace } from "./v1-decision-workspace.js";

describe("V1DecisionWorkspace", () => {
  it("keeps the decision trace, review queue, and fixture origin explicit", () => {
    const html = renderToStaticMarkup(createElement(V1DecisionWorkspace));

    expect(html).toContain("TEST / DEV FIXTURE");
    expect(html).toContain("Control Center");
    expect(html).toContain("Need BA Review");
    expect(html).toContain("Review Queue");
    expect(html).toContain("Rule Result");
    expect(html).toContain("AI Recommendation");
    expect(html).toContain("BA Decision");
    expect(html).toContain("Execution");
    expect(html).toContain("Observed value");
    expect(html).toContain("What would change the recommendation");
    expect(html).toContain("Decision history");
  });

  it("provides native decision controls and an explicitly disabled integration boundary", () => {
    const html = renderToStaticMarkup(createElement(V1DecisionWorkspace));

    expect(html).toContain('name="ba-decision"');
    expect(html).toContain('name="reason-code"');
    expect(html).toContain("Submit decision");
    expect(html).toContain("OPEN");
    expect(html).toContain("VERIFY");
    expect(html).toContain("SYNC SELECTED");
    expect(html).toContain("SYNC ALL ELIGIBLE");
    expect(html).toContain("Integration D required");
  });
});
