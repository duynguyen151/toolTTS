import { describe, expect, it } from "vitest";

import {
  beginGmailSyncReport,
  buildGmailSheetReportBatch,
  confirmGmailSheetReadback,
  confirmGmailSheetWrites,
  createGmailSyncReport,
  mergeGmailSyncReportBatch
} from "./gmail-sync-report.mts";

describe("Gmail Sheet write report", () => {
  const providers = [
    { providerId: "usps-id", carrierName: "USPS", region: "US" as const, isActive: true }
  ];

  it("separates confirmed tracking writes from provider-only writes", () => {
    const report = mergeGmailSyncReportBatch(
      createGmailSyncReport("FULL", "2026-09-12T00:00:00.000Z"),
      {
        trackingWritten: [{ rowNumber: 410, orderNumber: "ORDER-410", trackingNumber: "876458058248", provider: "USPS", messageId: "gmail-410" }],
        providerOnlyWritten: [{ rowNumber: 411, orderNumber: "ORDER-411", trackingNumber: "TRACK-411", provider: "USPS", messageId: "gmail-411" }],
        alreadyPresent: []
      },
      providers,
      "2026-09-12T00:01:00.000Z"
    );

    expect(report.trackingWritten).toEqual([expect.objectContaining({ rowNumber: 410, providerId: "usps-id", status: "READY_TO_ADD_TRACK" })]);
    expect(report.providerOnlyWritten.map((entry) => entry.rowNumber)).toEqual([411]);
  });

  it("deduplicates row plus tracking across batches", () => {
    const report = createGmailSyncReport("FULL", "2026-09-12T00:00:00.000Z");
    const batch = {
      trackingWritten: [{ rowNumber: 410, orderNumber: "ORDER-410", trackingNumber: "TRACK-410", provider: "USPS", messageId: "gmail-410" }],
      providerOnlyWritten: [],
      alreadyPresent: []
    };

    const once = mergeGmailSyncReportBatch(report, batch, providers, "2026-09-12T00:01:00.000Z");
    const twice = mergeGmailSyncReportBatch(once, batch, providers, "2026-09-12T00:02:00.000Z");
    expect(twice.trackingWritten).toHaveLength(1);
  });

  it("stores the active provider catalog snapshot for the whole scan", () => {
    expect(createGmailSyncReport("FULL", "2026-09-12T00:00:00.000Z", providers).providerCatalog).toEqual(providers);
  });

  it("preserves deduplicated history when a completed report starts another incremental run", () => {
    const completed = {
      ...mergeGmailSyncReportBatch(
        createGmailSyncReport("FULL", "2026-09-12T00:00:00.000Z", providers),
        { trackingWritten: [{ rowNumber: 410, orderNumber: "ORDER-410", trackingNumber: "TRACK-410", provider: "USPS", messageId: "gmail-410" }], providerOnlyWritten: [], alreadyPresent: [] },
        providers,
        "2026-09-12T00:01:00.000Z"
      ),
      completedAt: "2026-09-12T00:02:00.000Z"
    };

    const next = beginGmailSyncReport(completed, "INCREMENTAL", "2026-09-12T04:00:00.000Z");
    expect(next.completedAt).toBeUndefined();
    expect(next.trackingWritten).toHaveLength(1);
    expect(next.mode).toBe("INCREMENTAL");
  });

  it("marks tracking without a supported provider as not ready", () => {
    const report = mergeGmailSyncReportBatch(
      createGmailSyncReport("INCREMENTAL", "2026-09-12T00:00:00.000Z"),
      {
        trackingWritten: [{ rowNumber: 412, orderNumber: "ORDER-412", trackingNumber: "ODD-TRACKING", provider: "Unknown Carrier", messageId: "gmail-412" }],
        providerOnlyWritten: [],
        alreadyPresent: []
      },
      providers,
      "2026-09-12T00:01:00.000Z"
    );

    expect(report.trackingWritten[0]).toMatchObject({ providerId: null, status: "PROVIDER_UNSUPPORTED" });
  });

  it("reports only cells confirmed by the Sheets write response", () => {
    const batch = buildGmailSheetReportBatch(
      [{
        rowNumber: 410,
        orderNumber: "ORDER-410",
        trackingNumber: "TRACK-410",
        deliveryCompany: "USPS",
        oldTracking: "",
        oldProvider: "",
        messageId: "gmail-410"
      }, {
        rowNumber: 411,
        orderNumber: "ORDER-411",
        trackingNumber: "TRACK-411",
        deliveryCompany: "USPS",
        oldTracking: "TRACK-411",
        oldProvider: "",
        messageId: "gmail-411"
      }],
      [{ rowNumber: 410, column: "Z" }, { rowNumber: 410, column: "AC" }, { rowNumber: 411, column: "AC" }],
      []
    );

    expect(batch.trackingWritten.map((entry) => entry.rowNumber)).toEqual([410]);
    expect(batch.providerOnlyWritten.map((entry) => entry.rowNumber)).toEqual([411]);
  });

  it("falls back to the existing AC provider when Gmail only supplies tracking", () => {
    const batch = buildGmailSheetReportBatch(
      [{
        rowNumber: 412,
        orderNumber: "ORDER-412",
        trackingNumber: "7",
        deliveryCompany: "",
        oldTracking: "",
        oldProvider: "USPS",
        messageId: "gmail-412"
      }],
      [{ rowNumber: 412, column: "Z" }],
      []
    );

    expect(batch.trackingWritten).toEqual([
      expect.objectContaining({ rowNumber: 412, trackingNumber: "7", provider: "USPS" })
    ]);
  });

  it("accepts only the exact cells confirmed by Google Sheets", () => {
    expect(confirmGmailSheetWrites(
      [{ rowNumber: 410, column: "Z" }, { rowNumber: 410, column: "AC" }],
      [{ updatedRange: "'Tháng 9-US'!Z410", updatedCells: 1 }, { updatedRange: "'Tháng 9-US'!AC410", updatedCells: 1 }]
    )).toEqual([{ rowNumber: 410, column: "Z" }, { rowNumber: 410, column: "AC" }]);

    expect(() => confirmGmailSheetWrites(
      [{ rowNumber: 410, column: "Z" }],
      [{ updatedRange: "'Tháng 9-US'!Z411", updatedCells: 1 }]
    )).toThrow("did not confirm Z410");
  });

  it("requires readback values to match every written cell", () => {
    expect(confirmGmailSheetReadback(
      [{ rowNumber: 410, column: "Z", value: "TRACK-410" }],
      [{ range: "'Tháng 9-US'!Z410", values: [["TRACK-410"]] }]
    )).toEqual([{ rowNumber: 410, column: "Z" }]);

    expect(() => confirmGmailSheetReadback(
      [{ rowNumber: 410, column: "Z", value: "TRACK-410" }],
      [{ range: "'Tháng 9-US'!Z410", values: [["OTHER"]] }]
    )).toThrow("readback mismatch at Z410");
  });

  it("keeps tracking conflicts in a separate skipped group", () => {
    const report = mergeGmailSyncReportBatch(
      createGmailSyncReport("FULL", "2026-09-12T00:00:00.000Z"),
      { trackingWritten: [], providerOnlyWritten: [], alreadyPresent: [], skipped: [{
        rowNumber: 413,
        orderNumber: "ORDER-413",
        trackingNumber: "EMAIL-TRACK",
        provider: "USPS",
        messageId: "gmail-413",
        reason: "TRACKING_CONFLICT"
      }] },
      providers,
      "2026-09-12T00:01:00.000Z"
    );

    expect(report.skipped).toEqual([expect.objectContaining({ rowNumber: 413, reason: "TRACKING_CONFLICT" })]);
  });
});
