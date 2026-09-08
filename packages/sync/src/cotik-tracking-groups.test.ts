import { describe, expect, it } from "vitest";

import { groupCotikTrackingRows } from "./cotik-tracking-sheets.js";

function row(
  rowNumber: number,
  account: string,
  orderId: string,
  sheinOrderId: string,
  tracking: string,
  providerNote: string
) {
  return {
    rowNumber,
    account,
    orderId,
    sheinOrderId,
    tracking,
    trackingColumn: "Z" as const,
    providerNote,
    result: ""
  };
}

describe("Cotik tracking row groups", () => {
  it("accepts repeated product rows when only the first row has tracking and provider", () => {
    const groups = groupCotikTrackingRows([
      row(10, "ACC-1", "TTS-1", "SHEIN-1", "TRACK-1", "USPS"),
      row(11, "ACC-1", "TTS-1", "SHEIN-1", "", ""),
      row(12, "ACC-1", "TTS-1", "SHEIN-1", "", "")
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      orderId: "TTS-1",
      status: "READY",
      tracking: "TRACK-1",
      providerNote: "USPS"
    });
  });

  it("pauses one Cotik order when Shein has multiple order IDs even with one tracking", () => {
    const groups = groupCotikTrackingRows([
      row(10, "ACC-1", "TTS-1", "SHEIN-1", "TRACK-1", "USPS"),
      row(11, "ACC-1", "TTS-1", "SHEIN-2", "", "")
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        orderId: "TTS-1",
        status: "PAUSED",
        reason: "SPLIT_ORDER_REVIEW_REQUIRED"
      })
    ]);
  });

  it("pauses one Cotik order when the same group has multiple tracking IDs", () => {
    const groups = groupCotikTrackingRows([
      row(10, "ACC-1", "TTS-1", "SHEIN-1", "TRACK-1", "USPS"),
      row(11, "ACC-1", "TTS-1", "SHEIN-2", "TRACK-2", "USPS")
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        orderId: "TTS-1",
        status: "PAUSED",
        reason: "SPLIT_ORDER_REVIEW_REQUIRED"
      })
    ]);
  });

  it("does not pause other Cotik orders when one group needs review", () => {
    const groups = groupCotikTrackingRows([
      row(10, "ACC-1", "TTS-1", "SHEIN-1", "TRACK-1", "USPS"),
      row(11, "ACC-1", "TTS-1", "SHEIN-2", "", ""),
      row(12, "ACC-1", "TTS-2", "SHEIN-3", "TRACK-3", "USPS")
    ]);

    expect(groups.map((group) => [group.orderId, group.status])).toEqual([
      ["TTS-1", "PAUSED"],
      ["TTS-2", "READY"]
    ]);
  });

  it("uses completed rows as context so a later split row cannot bypass the group guard", () => {
    const groups = groupCotikTrackingRows(
      [row(11, "ACC-1", "TTS-1", "SHEIN-2", "TRACK-2", "USPS")],
      [
        row(10, "ACC-1", "TTS-1", "SHEIN-1", "TRACK-1", "USPS"),
        row(11, "ACC-1", "TTS-1", "SHEIN-2", "TRACK-2", "USPS")
      ]
    );

    expect(groups[0]).toMatchObject({ status: "PAUSED", reason: "SPLIT_ORDER_REVIEW_REQUIRED" });
  });

  it("keeps the same Cotik order in separate account groups", () => {
    const groups = groupCotikTrackingRows([
      row(10, "ACC-1", "TTS-1", "SHEIN-1", "TRACK-1", "USPS"),
      row(11, "ACC-2", "TTS-1", "SHEIN-1", "TRACK-2", "USPS")
    ]);

    expect(groups.map((group) => [group.account, group.orderId])).toEqual([
      ["ACC-1", "TTS-1"],
      ["ACC-2", "TTS-1"]
    ]);
  });
});
