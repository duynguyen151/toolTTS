import { describe, expect, it } from "vitest";

import type { ShopRow } from "@shop-health/db";
import type { ShopSourceConfig } from "@shop-health/domain";

// The integration path requires PostgreSQL; this test locks the public result contract only.
import type { SyncResult } from "./index.js";

describe("sync result contract", () => {
  it("supports an advisory-lock skip without pretending work ran", () => {
    const result: SyncResult = {
      status: "SKIPPED",
      syncRunId: null,
      rowsRead: 0,
      rowsWritten: 0,
      checkpoint: null,
      complete: false
    };
    expect(result).toEqual(expect.objectContaining({ status: "SKIPPED", rowsWritten: 0 }));
  });

  it("keeps shop/source identifiers explicit", () => {
    const shop = {
      id: "00000000-0000-0000-0000-000000000001",
      profileId: "k1f2ocuk",
      profileNo: "957",
      region: "US",
      locale: "en-US"
    } as Pick<ShopRow, "id" | "profileId" | "profileNo" | "region" | "locale">;
    const source: ShopSourceConfig = {
      shopId: shop.id,
      profileId: shop.profileId,
      profileNo: shop.profileNo,
      region: "US",
      locale: "en-US"
    };
    expect(source.profileNo).toBe("957");
  });
});
