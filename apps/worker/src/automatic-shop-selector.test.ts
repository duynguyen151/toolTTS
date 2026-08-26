import { describe, expect, it } from "vitest";

import { selectAutomaticOrdersShops } from "./automatic-shop-selector.js";

describe("selectAutomaticOrdersShops", () => {
  it("excludes shops not eligible for automatic refresh", () => {
    const automaticShop = { id: "active-shop" };
    const provenDeactiveShop = { id: "deactive-shop" };

    expect(selectAutomaticOrdersShops([automaticShop, provenDeactiveShop], [automaticShop]))
      .toEqual([automaticShop]);
  });
});
