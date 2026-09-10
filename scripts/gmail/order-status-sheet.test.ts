import { describe, expect, it } from "vitest";

import {
  buildStatusBatchPayload,
  groupOrderStatusRows,
  type SheetOrderIdRow
} from "./order-status-sheet.mts";

describe("order status sheet updates", () => {
  it("groups sheet rows by Supabase status and preserves duplicate OrderIDs", () => {
    const rows: SheetOrderIdRow[] = [
      { rowNumber: 2, orderId: "ORDER-A" },
      { rowNumber: 3, orderId: "ORDER-B" },
      { rowNumber: 4, orderId: " order-a " },
      { rowNumber: 5, orderId: "ORDER-C" },
      { rowNumber: 6, orderId: "" }
    ];

    expect(
      groupOrderStatusRows(rows, new Map([
        ["ORDER-A", "DELIVERED"],
        ["ORDER-B", "IN_TRANSIT"]
      ]))
    ).toEqual([
      { status: "DELIVERED", rowNumbers: [2, 4] },
      { status: "IN_TRANSIT", rowNumbers: [3] },
      { status: "NOT_FOUND", rowNumbers: [5] }
    ]);
  });

  it("builds one RAW value entry per row inside a status group", () => {
    expect(
      buildStatusBatchPayload("TAB", {
        status: "DELIVERED",
        rowNumbers: [2, 4]
      })
    ).toEqual([
      { range: "'TAB'!AI2", values: [["DELIVERED"]] },
      { range: "'TAB'!AI4", values: [["DELIVERED"]] }
    ]);
  });

  it("skips rows whose AI cell already has the current status", () => {
    expect(
      groupOrderStatusRows([
        { rowNumber: 2, orderId: "ORDER-A", currentStatus: "DELIVERED" },
        { rowNumber: 3, orderId: "ORDER-B", currentStatus: "" }
      ], new Map([
        ["ORDER-A", "DELIVERED"],
        ["ORDER-B", "IN_TRANSIT"]
      ]))
    ).toEqual([{ status: "IN_TRANSIT", rowNumbers: [3] }]);
  });
});
