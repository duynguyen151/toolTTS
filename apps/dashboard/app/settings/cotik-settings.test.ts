import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CotikSettings } from "./cotik-settings.js";

describe("Cotik settings provider surface", () => {
  it("shows the explicit provider catalog instead of tracking matching rules", () => {
    const html = renderToStaticMarkup(createElement(CotikSettings, {
      accounts: [],
      providers: [{ providerId: "provider-us", carrierName: "USPS", region: "US" }],
      logicalShops: [],
      syncEnabled: false,
      postEnabled: false,
    }));

    expect(html).toContain("Explicit Provider Catalog");
    expect(html).toContain("USPS");
    expect(html).not.toContain("Matching Rules");
    expect(html).not.toContain("Provider Rules");
  });
});
