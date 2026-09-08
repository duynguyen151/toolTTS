import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CotikTracking, buildCotikTrackingRequest } from "./cotik-tracking.js";

describe("Cotik tracking input", () => {
  it("renders the shop-bound region and explicit provider field", () => {
    const html = renderToStaticMarkup(createElement(CotikTracking, {
      logicalShops: [
        { id: "shop-us", displayName: "Shop US", region: "US" },
        { id: "shop-uk", displayName: "Shop UK", region: "UK" },
      ],
      providers: [
        { providerId: "provider-us", carrierName: "USPS", region: "US" },
      ],
    }));

    expect(html).toContain('name="logicalShopId"');
    expect(html).toContain("Shop US");
    expect(html).toContain("Region: US");
    expect(html).toContain("worker may send pending tracking");
    expect(html).not.toContain("accountId");
    expect(html).toContain('name="provider"');
    expect(html).toContain("USPS (provider-us)");
  });

  it("builds only the server-authoritative staging input", () => {
    expect(buildCotikTrackingRequest({
      logicalShopId: "shop-us",
      orderId: " ORDER-1 ",
      tracking: " GFU123 ",
      provider: " provider-us ",
      region: "US",
    })).toEqual({
      logicalShopId: "shop-us",
      orderId: "ORDER-1",
      tracking: "GFU123",
      provider: "provider-us",
      region: "US",
    });
  });
});
