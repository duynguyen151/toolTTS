import { describe, expect, it, vi } from "vitest";

import {
  readCotikTrackingSheet,
  readCotikTrackingSheetBatch,
  writeCotikTrackingSheetResults
} from "./cotik-tracking-sheets.js";

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

describe("read-only Cotik tracking Sheets adapter", () => {
  it("validates the exact tab metadata before reading exact values", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { sheets: [{ properties: { title: "Orders" } }] }))
      .mockResolvedValueOnce(response(200, { values: [["orderId", "tracking"], ["order-1", "TRACK-1"]] }));

    await expect(readCotikTrackingSheet(
      { spreadsheetId: "sheet-1", tabTitle: "Orders", range: "A1:B2" },
      { accessToken: "server-token", fetch }
    )).resolves.toEqual([{ orderId: "order-1", tracking: "TRACK-1" }]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/spreadsheets/sheet-1?");
    expect(String(fetch.mock.calls[1]?.[0])).toContain("'Orders'!A1%3AB2");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer server-token" }
    });
  });

  it("does not request values when the exact tab title is absent", async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, { sheets: [{ properties: { title: "Other" } }] }));

    await expect(readCotikTrackingSheet(
      { spreadsheetId: "sheet-1", tabTitle: "Orders", range: "A1:B2" },
      { accessToken: "server-token", fetch }
    )).rejects.toThrow("exact tab title");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("requires the exact orderId/tracking header contract", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { sheets: [{ properties: { title: "Orders" } }] }))
      .mockResolvedValueOnce(response(200, { values: [["date", "orderId", "tracking"]] }));

    await expect(readCotikTrackingSheet(
      { spreadsheetId: "sheet-1", tabTitle: "Orders", range: "A1:C1" },
      { accessToken: "server-token", fetch }
    )).rejects.toThrow("header contract");
  });

  it("rejects numeric order and tracking cells to prevent precision loss", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { sheets: [{ properties: { title: "Orders" } }] }))
      .mockResolvedValueOnce(response(200, { values: [["orderId", "tracking"], [12345678901234567890, "TRACK-1"]] }));

    await expect(readCotikTrackingSheet(
      { spreadsheetId: "sheet-1", tabTitle: "Orders", range: "A1:B2" },
      { accessToken: "server-token", fetch }
    )).rejects.toThrow("numeric");
  });

  it("rejects ranges with more than 50 data rows before any request", async () => {
    const fetch = vi.fn();

    await expect(readCotikTrackingSheet(
      { spreadsheetId: "sheet-1", tabTitle: "Orders", range: "A1:B52" },
      { accessToken: "server-token", fetch }
    )).rejects.toThrow("at most 50 data rows");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sanitizes OAuth failures without leaking the access token or response body", async () => {
    const secret = "oauth-secret-value";
    const fetch = vi.fn().mockResolvedValue(response(401, { error: secret }));

    const error = await readCotikTrackingSheet(
      { spreadsheetId: "sheet-1", tabTitle: "Orders", range: "A1:B2" },
      { accessToken: secret, fetch }
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(secret);
    expect(String(error)).not.toContain("response body");
  });

  it("aborts a hanging Sheets request at the configured timeout", async () => {
    const fetch = vi.fn((_request: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")));
    }));

    await expect(readCotikTrackingSheet(
      { spreadsheetId: "sheet-1", tabTitle: "Orders", range: "A1:B2" },
      { accessToken: "server-token", fetch, timeoutMs: 1 }
    )).rejects.toThrow("timed out");
  });
});

describe("date-scoped Cotik tracking Sheets workflow", () => {
  it("requires the date-scoped source range to start at A and include AC", async () => {
    const fetch = vi.fn();

    await expect(readCotikTrackingSheetBatch(
      { spreadsheetId: "sheet-1", tabTitle: "Tháng 9-US", range: "B1:AB5", targetDate: "2026-09-04" },
      { accessToken: "server-token", fetch }
    )).rejects.toThrow("start at column A and include columns through AC");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an override that moves the Cotik OrderID away from fixed column B", async () => {
    const fetch = vi.fn();

    await expect(readCotikTrackingSheetBatch(
      {
        spreadsheetId: "sheet-1",
        tabTitle: "Tháng 9-US",
        range: "A1:AC5",
        targetDate: "2026-09-04",
        cotikOrderIdColumn: "C"
      },
      { accessToken: "server-token", fetch }
    )).rejects.toThrow("fixed column B");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires the fixed B/Y/Z/AC headers before selecting rows", async () => {
    const row = Array.from({ length: 29 }, () => "");
    row[0] = "2026-09-04";
    row[1] = "cotik-order-1";
    row[24] = "shein-order-1";
    row[25] = "TRACK-Z";
    row[28] = "USPS";
    const header = Array.from({ length: 29 }, () => "");
    header[0] = "Created date";
    header[1] = "Cotik Order ID";
    header[22] = "Result";
    header[24] = "Shein Order ID";
    header[25] = "Tracking ID";
    header[28] = "Wrong header";
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { sheets: [{ properties: { title: "Tháng 9-US" } }] }))
      .mockResolvedValueOnce(response(200, { values: [header, row] }));

    await expect(readCotikTrackingSheetBatch(
      { spreadsheetId: "sheet-1", tabTitle: "Tháng 9-US", range: "A1:AC2", targetDate: "2026-09-04" },
      { accessToken: "server-token", fetch }
    )).rejects.toThrow("AC provider header");
  });

  it("selects 2026-09-04 rows from B as Cotik OrderID and Z as tracking, skipping nonblank W", async () => {
    const row = Array.from({ length: 29 }, () => "");
    row[0] = "2026-09-04";
    row[1] = "cotik-order-1";
    row[24] = "shein-order-1";
    row[25] = "TRACK-Z";
    row[28] = "Gofo Express";
    const second = [...row];
    second[0] = "2026-09-03";
    second[1] = "cotik-order-2";
    second[24] = "shein-order-2";
    second[25] = "TRACK-Z2";
    const third = [...row];
    third[1] = "cotik-order-3";
    third[24] = "shein-order-3";
    third[22] = "already written";
    third[25] = "TRACK-Z3";
    const header = Array.from({ length: 29 }, () => "");
    header[0] = "Created date";
    header[1] = "Cotik Order ID";
    header[22] = "Result";
    header[24] = "Shein Order ID";
    header[25] = "Tracking ID";
    header[28] = "Provider";
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { sheets: [{ properties: { title: "Tháng 9-US" } }] }))
      .mockResolvedValueOnce(response(200, {
        values: [
          ["", "", ...Array(27).fill("")],
          header,
          row,
          second,
          third
        ]
      }));

    await expect(readCotikTrackingSheetBatch(
      { spreadsheetId: "sheet-1", tabTitle: "Tháng 9-US", range: "A1:AC5", targetDate: "2026-09-04" },
      { accessToken: "server-token", fetch }
    )).resolves.toMatchObject({
      headerRow: 2,
      rows: [{ rowNumber: 3, orderId: "cotik-order-1", sheinOrderId: "shein-order-1", tracking: "TRACK-Z", trackingColumn: "Z", providerNote: "Gofo Express" }],
      skippedRows: [{ rowNumber: 5, reason: "RESULT_ALREADY_PRESENT" }]
    });
  });
  it("treats Shein OrderID in Y without tracking in Z as missing tracking", async () => {
    const row = Array.from({ length: 29 }, () => "");
    row[0] = "2026-09-04";
    row[1] = "cotik-order-1";
    row[24] = "shein-order-1";
    row[28] = "Provider";
    const header = Array.from({ length: 29 }, () => "");
    header[0] = "Created date";
    header[1] = "Cotik Order ID";
    header[22] = "Result";
    header[24] = "Shein Order ID";
    header[25] = "Tracking ID";
    header[28] = "Provider";
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { sheets: [{ properties: { title: "Tháng 9-US" } }] }))
      .mockResolvedValueOnce(response(200, { values: [header, row] }));
    await expect(readCotikTrackingSheetBatch(
      { spreadsheetId: "sheet-1", tabTitle: "Tháng 9-US", range: "A1:AC2", targetDate: "2026-09-04" },
      { accessToken: "server-token", fetch }
    )).resolves.toMatchObject({ rows: [], skippedRows: [{ rowNumber: 2, reason: "MISSING_TRACKING" }] });
  });
  it("writes a blank W cell using a nested matrix and verifies the readback", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { sheets: [{ properties: { title: "Tháng 9-US" } }] }))
      .mockResolvedValueOnce(response(200, { values: [[""]] }))
      .mockResolvedValueOnce(response(200, { updatedRange: "'Tháng 9-US'!W195" }))
      .mockResolvedValueOnce(response(200, { values: [["POST_CONFIRMED"]] }));
    await expect(writeCotikTrackingSheetResults(
      { spreadsheetId: "sheet-1", tabTitle: "Tháng 9-US", results: [{ rowNumber: 195, result: "POST_CONFIRMED" }] },
      { accessToken: "server-token", fetch }
    )).resolves.toEqual([{ rowNumber: 195, status: "WRITTEN" }]);
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ range: "'Tháng 9-US'!W195", majorDimension: "ROWS", values: [["POST_CONFIRMED"]] })
    });
  });
});
