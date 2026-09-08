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

  it("requires the fixed B/Q/Y/Z/AC headers before selecting rows", async () => {
    const row = Array.from({ length: 29 }, () => "");
    row[0] = "2026-09-04";
    row[1] = "cotik-order-1";
    row[16] = "acc-1";
    row[24] = "shein-order-1";
    row[25] = "TRACK-Z";
    row[28] = "USPS";
    const header = Array.from({ length: 29 }, () => "");
    header[0] = "Created date";
    header[1] = "Cotik Order ID";
    header[16] = "Acc";
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

  it("selects 2026-09-04 rows from Q/B and retains W", async () => {
    const row = Array.from({ length: 29 }, () => "");
    row[0] = "2026-09-04";
    row[1] = "cotik-order-1";
    row[16] = "acc-1";
    row[24] = "shein-order-1";
    row[25] = "TRACK-Z";
    row[28] = "Gofo Express";
    const second = [...row];
    second[0] = "2026-09-03";
    second[1] = "cotik-order-2";
    second[16] = "acc-2";
    second[24] = "shein-order-2";
    second[25] = "TRACK-Z2";
    const third = [...row];
    third[1] = "cotik-order-3";
    third[16] = "acc-1";
    third[24] = "shein-order-3";
    third[22] = "already written";
    third[25] = "TRACK-Z3";
    const header = Array.from({ length: 29 }, () => "");
    header[0] = "Created date";
    header[1] = "Cotik Order ID";
    header[16] = "Acc";
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
      rows: [
        { rowNumber: 3, account: "acc-1", orderId: "cotik-order-1", sheinOrderId: "shein-order-1", tracking: "TRACK-Z", trackingColumn: "Z", providerNote: "Gofo Express", result: "" },
        { rowNumber: 5, account: "acc-1", orderId: "cotik-order-3", sheinOrderId: "shein-order-3", tracking: "TRACK-Z3", trackingColumn: "Z", providerNote: "Gofo Express", result: "already written" }
      ],
      groupRows: [
        { rowNumber: 3, account: "acc-1", orderId: "cotik-order-1", sheinOrderId: "shein-order-1", tracking: "TRACK-Z", providerNote: "Gofo Express", result: "" },
        { rowNumber: 5, account: "acc-1", orderId: "cotik-order-3", sheinOrderId: "shein-order-3", tracking: "TRACK-Z3", providerNote: "Gofo Express", result: "already written" }
      ],
      skippedRows: []
    });
  });

  it("selects every eligible row on or after fromDate through the end of the source range", async () => {
    const makeRow = (date: string, orderId: string, tracking: string, provider: string) => {
      const row = Array.from({ length: 29 }, () => "");
      row[0] = date;
      row[1] = orderId;
      row[16] = "acc-1";
      row[24] = `shein-${orderId}`;
      row[25] = tracking;
      row[28] = provider;
      return row;
    };
    const header = Array.from({ length: 29 }, () => "");
    header[0] = "Created date";
    header[1] = "Cotik Order ID";
    header[16] = "Acc";
    header[22] = "Result";
    header[24] = "Shein Order ID";
    header[25] = "Tracking ID";
    header[28] = "Provider";
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { sheets: [{ properties: { title: "Tháng 9-US" } }] }))
      .mockResolvedValueOnce(response(200, {
        values: [
          header,
          makeRow("2026-09-03", "before", "TRACK-0", "USPS"),
          makeRow("2026-09-04", "start", "TRACK-1", "USPS"),
          makeRow("2026-09-05", "after", "TRACK-2", "USPS")
        ]
      }));

    await expect(readCotikTrackingSheetBatch(
      { spreadsheetId: "sheet-1", tabTitle: "Tháng 9-US", range: "A1:AC4", fromDate: "2026-09-04" },
      { accessToken: "server-token", fetch }
    )).resolves.toMatchObject({
      rows: [
        { rowNumber: 3, orderId: "start" },
        { rowNumber: 4, orderId: "after" }
      ]
    });
  });

  it("requires exactly one date selector", async () => {
    const fetch = vi.fn();
    await expect(readCotikTrackingSheetBatch(
      { spreadsheetId: "sheet-1", tabTitle: "Tháng 9-US", range: "A1:AC2" },
      { accessToken: "server-token", fetch }
    )).rejects.toThrow("one of targetDate or fromDate");
    await expect(readCotikTrackingSheetBatch(
      { spreadsheetId: "sheet-1", tabTitle: "Tháng 9-US", range: "A1:AC2", targetDate: "2026-09-04", fromDate: "2026-09-04" },
      { accessToken: "server-token", fetch }
    )).rejects.toThrow("mutually exclusive");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts the live sheet's Done header in AC while reading the explicit provider value", async () => {
    const header = Array.from({ length: 29 }, () => "");
    header[0] = "Date";
    header[1] = "Order ID";
    header[16] = "Acc";
    header[22] = "Note";
    header[24] = "Oder ID";
    header[25] = "Tracking ID ";
    header[28] = "Done";
    const row = Array.from({ length: 29 }, () => "");
    row[0] = "2026-09-01";
    row[1] = "cotik-order-1";
    row[16] = "acc-1";
    row[24] = "shein-order-1";
    row[25] = "TRACK-1";
    row[28] = "USPS";
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { sheets: [{ properties: { title: "Tháng 9-US" } }] }))
      .mockResolvedValueOnce(response(200, { values: [header, row] }));

    await expect(readCotikTrackingSheetBatch(
      { spreadsheetId: "sheet-1", tabTitle: "Tháng 9-US", range: "A1:AC2", fromDate: "2026-09-01" },
      { accessToken: "server-token", fetch }
    )).resolves.toMatchObject({
      rows: [{ orderId: "cotik-order-1", providerNote: "USPS" }]
    });
  });

  it("keeps Shein OrderID in Y without tracking in Z for order grouping", async () => {
    const row = Array.from({ length: 29 }, () => "");
    row[0] = "2026-09-04";
    row[1] = "cotik-order-1";
    row[16] = "acc-1";
    row[24] = "shein-order-1";
    row[28] = "Provider";
    const header = Array.from({ length: 29 }, () => "");
    header[0] = "Created date";
    header[1] = "Cotik Order ID";
    header[16] = "Acc";
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
    )).resolves.toMatchObject({
      rows: [{ rowNumber: 2, account: "acc-1", orderId: "cotik-order-1", sheinOrderId: "shein-order-1", tracking: "", trackingColumn: "Z", providerNote: "Provider", result: "" }],
      skippedRows: []
    });
  });
  it("overwrites W unconditionally using a nested matrix and verifies the readback", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { sheets: [{ properties: { title: "Tháng 9-US" } }] }))
      .mockResolvedValueOnce(response(200, { updatedRange: "'Tháng 9-US'!W195" }))
      .mockResolvedValueOnce(response(200, { values: [["POST_CONFIRMED"]] }));
    await expect(writeCotikTrackingSheetResults(
      { spreadsheetId: "sheet-1", tabTitle: "Tháng 9-US", results: [{ rowNumber: 195, result: "POST_CONFIRMED" }] },
      { accessToken: "server-token", fetch }
    )).resolves.toEqual([{ rowNumber: 195, status: "WRITTEN" }]);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ range: "'Tháng 9-US'!W195", majorDimension: "ROWS", values: [["POST_CONFIRMED"]] })
    });
  });
});
