import { z } from "zod";

export const RefreshEligibilityModeSchema = z.enum(["AUTOMATIC", "MANUAL"]);

export const RefreshObservedStatusSchema = z.string().trim().transform((value) => value.toLowerCase()).pipe(
  z.enum(["active", "deactive", "unknown"]),
);

export const RefreshEligibilityReasonCodeSchema = z.enum([
  "ELIGIBLE",
  "MANUAL_OVERRIDE",
  "SKIPPED_DEACTIVE",
  "SKIPPED_STATUS_UNKNOWN",
  "SKIPPED_STATUS_MISSING",
]);

export const RefreshEligibilityInputSchema = z.strictObject({
  mode: RefreshEligibilityModeSchema,
  shopStatus: RefreshObservedStatusSchema.nullable().default(null),
  profileStatus: RefreshObservedStatusSchema.nullable().default(null),
});

export const RefreshEligibilityResultSchema = z.strictObject({
  eligible: z.boolean(),
  reasonCode: RefreshEligibilityReasonCodeSchema,
});

export type RefreshEligibilityInput = z.input<typeof RefreshEligibilityInputSchema>;
export type RefreshEligibilityResult = z.output<typeof RefreshEligibilityResultSchema>;
export type RefreshObservedStatus = z.output<typeof RefreshObservedStatusSchema>;

export function resolveObservedProfileStatus(value: string | null | undefined): z.output<typeof RefreshObservedStatusSchema> {
  if (value === null || value === undefined || value.trim() === "") return "unknown";
  const normalized = value.trim().toLowerCase();
  return normalized === "active" || normalized === "deactive"
    ? RefreshObservedStatusSchema.parse(normalized)
    : "unknown";
}

export function normalizeObservedTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}

export function resolveObservedStatusFromTags(tags: readonly string[]): z.output<typeof RefreshObservedStatusSchema> | null {
  const normalized = normalizeObservedTags(tags);
  if (normalized.length === 0) return null;
  if (normalized.includes("deactive")) return "deactive";
  if (normalized.includes("active")) return "active";
  return "unknown";
}

export function resolveRefreshEligibility(input: RefreshEligibilityInput): RefreshEligibilityResult {
  const observed = RefreshEligibilityInputSchema.parse(input);
  if (observed.mode === "MANUAL") {
    return RefreshEligibilityResultSchema.parse({ eligible: true, reasonCode: "MANUAL_OVERRIDE" });
  }
  if (observed.shopStatus === "deactive" || observed.profileStatus === "deactive") {
    return RefreshEligibilityResultSchema.parse({ eligible: false, reasonCode: "SKIPPED_DEACTIVE" });
  }
  if (observed.shopStatus === null || observed.profileStatus === null) {
    return RefreshEligibilityResultSchema.parse({ eligible: false, reasonCode: "SKIPPED_STATUS_MISSING" });
  }
  if (observed.shopStatus !== "active" || observed.profileStatus !== "active") {
    return RefreshEligibilityResultSchema.parse({ eligible: false, reasonCode: "SKIPPED_STATUS_UNKNOWN" });
  }
  return RefreshEligibilityResultSchema.parse({ eligible: true, reasonCode: "ELIGIBLE" });
}

export const ProxyCapabilityStatusSchema = z.enum(["CONFIGURED", "UNCONFIGURED", "UNAVAILABLE"]);
export const ProxyCapabilityReasonCodeSchema = z.enum([
  "PROXY_CONFIGURED",
  "PROXY_UNCONFIGURED",
  "ADSPOWER_UNAVAILABLE",
  "CAPABILITY_TIMEOUT",
  "PROXY_UNKNOWN",
]);
export const ProxyCapabilityResultSchema = z.strictObject({
  status: ProxyCapabilityStatusSchema,
  reasonCode: ProxyCapabilityReasonCodeSchema,
});
export type ProxyCapabilityResult = z.output<typeof ProxyCapabilityResultSchema>;
