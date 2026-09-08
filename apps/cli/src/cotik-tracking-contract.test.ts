import { describe, expect, it } from "vitest";

import { parseAutoTrackingRequest } from "./cotik-tracking-contract.js";

describe("auto-tracking JSON contract", () => {
  it("accepts an execute payload", () => {
    expect(parseAutoTrackingRequest(JSON.stringify({
      action: "execute",
      input: {
        spreadsheetId: "sheet-1",
        tab: "Tháng 9-US",
        range: "A1:AC2000",
        region: "US",
        fromDate: "2026-09-04"
      }
    }))).toEqual({
      action: "execute",
      input: {
        spreadsheetId: "sheet-1",
        tab: "Tháng 9-US",
        range: "A1:AC2000",
        region: "US",
        fromDate: "2026-09-04"
      }
    });
  });

  it("rejects implicit enablement and non-US requests", () => {
    expect(() => parseAutoTrackingRequest(JSON.stringify({ action: "enable" }))).toThrow();
    expect(() => parseAutoTrackingRequest(JSON.stringify({
      action: "execute",
      input: {
        spreadsheetId: "sheet-1",
        tab: "Tháng 9-US",
        range: "A1:AC2000",
        shopId: "shop-1",
        region: "UK",
        fromDate: "2026-09-04"
      }
    }))).toThrow();
  });

  it("accepts writeback false for a POST-only execution", () => {
    expect(parseAutoTrackingRequest(JSON.stringify({
      action: "execute",
      input: {
        spreadsheetId: "sheet-1",
        tab: "Tháng 9-US",
        range: "A1:AC2000",
        region: "US",
        fromDate: "2026-09-04",
        writeback: false
      }
    }))).toMatchObject({
      action: "execute",
      input: { writeback: false }
    });
  });
});
