import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { LiveBaForm } from "./live-ba-form.js";

describe("LiveBaForm", () => {
  it("renders only the LIVE backend submission controls", () => {
    const html = renderToStaticMarkup(createElement(LiveBaForm, {
      caseId: "00000000-0000-4000-8000-000000000001",
      profileNo: "957",
    }));

    expect(html).toContain("Submit BA decision");
    expect(html).toContain('value="SCALE"');
    expect(html).toContain('value="CONTINUE"');
    expect(html).toContain('value="WATCH"');
    expect(html).toContain('value="PAUSE"');
    expect(html).toContain('value="OTHER"');
    expect(html).toContain('name="notes"');
    expect(html).not.toContain("fixture");
  });
});
