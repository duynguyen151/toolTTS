import { describe, expect, it } from "vitest";

import {
  normalizeObservedTags,
  ProxyCapabilityResultSchema,
  resolveObservedProfileStatus,
  resolveObservedStatusFromTags,
  resolveRefreshEligibility,
} from "./refresh-eligibility.js";

describe("refresh eligibility contract", () => {
  it("returns explicit automatic reasons for active, deactive, unknown, and missing observed statuses", () => {
    expect(resolveRefreshEligibility({ mode: "AUTOMATIC", shopStatus: "active", profileStatus: "ACTIVE" }))
      .toEqual({ eligible: true, reasonCode: "ELIGIBLE" });
    expect(resolveRefreshEligibility({ mode: "AUTOMATIC", shopStatus: "active", profileStatus: "deactive" }))
      .toEqual({ eligible: false, reasonCode: "SKIPPED_DEACTIVE" });
    expect(resolveRefreshEligibility({ mode: "AUTOMATIC", shopStatus: "unknown", profileStatus: "active" }))
      .toEqual({ eligible: false, reasonCode: "SKIPPED_STATUS_UNKNOWN" });
    expect(resolveRefreshEligibility({ mode: "AUTOMATIC", shopStatus: null, profileStatus: "active" }))
      .toEqual({ eligible: false, reasonCode: "SKIPPED_STATUS_MISSING" });
  });

  it("normalizes only explicit active/deactive tags and maps other tag combinations to unknown", () => {
    expect(resolveObservedProfileStatus("  DeAcTiVe ")).toBe("deactive");
    expect(resolveObservedProfileStatus("active")).toBe("active");
    expect(resolveObservedProfileStatus(undefined)).toBe("unknown");
    expect(resolveObservedProfileStatus("holiday-mode")).toBe("unknown");
  });

  it("derives tag status only from explicit case-insensitive active/deactive tags", () => {
    expect(resolveObservedStatusFromTags(["US", " DeAcTiVe "])).toBe("deactive");
    expect(resolveObservedStatusFromTags(["active", "US"])).toBe("active");
    expect(resolveObservedStatusFromTags(["active", "deactive"])).toBe("deactive");
    expect(resolveObservedStatusFromTags(["US"])).toBe("unknown");
    expect(resolveObservedStatusFromTags([])).toBeNull();
    expect(normalizeObservedTags([" Active ", "active", "DEACTIVE"])).toEqual(["active", "deactive"]);
  });

  it("keeps manual refresh available while retaining the observed reason", () => {
    expect(resolveRefreshEligibility({ mode: "MANUAL", shopStatus: "deactive", profileStatus: "active" }))
      .toEqual({ eligible: true, reasonCode: "MANUAL_OVERRIDE" });
  });

  it("requires explicit proxy capability reason codes", () => {
    expect(ProxyCapabilityResultSchema.parse({ status: "UNAVAILABLE", reasonCode: "CAPABILITY_TIMEOUT" }))
      .toEqual({ status: "UNAVAILABLE", reasonCode: "CAPABILITY_TIMEOUT" });
    expect(ProxyCapabilityResultSchema.parse({ status: "UNAVAILABLE", reasonCode: "PROXY_UNKNOWN" }))
      .toEqual({ status: "UNAVAILABLE", reasonCode: "PROXY_UNKNOWN" });
    expect(() => ProxyCapabilityResultSchema.parse({ status: "UNAVAILABLE", reasonCode: "PROXY_EXPIRED" }))
      .toThrow();
  });
});
