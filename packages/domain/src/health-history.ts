import { resolveAnalyticalDeliveryPeriod, type AnalyticalDeliveryPeriodKey } from "./delivery-rate.js";

export type ObjectiveAnalyticalPeriodKey = AnalyticalDeliveryPeriodKey;

export interface ObjectiveAnalyticalPeriod {
  readonly key: ObjectiveAnalyticalPeriodKey;
  readonly label: string;
  readonly start: Date | null;
  readonly end: Date;
  readonly comparison: { readonly start: Date; readonly end: Date } | null;
  readonly deltaStatus: "EVALUATED" | "NOT_EVALUATED";
  readonly deltaReason: "NO_PERSISTED_SOURCE_DATA" | "ALL_AVAILABLE_HAS_NO_COMPARABLE_BASELINE" | null;
}

export interface ResolveObjectiveAnalyticalPeriodsInput {
  readonly now: Date;
  readonly firstAvailableAt: Date | null;
}

export const UNCONFIGURED_CATEGORICAL_TRENDS = [
  "RAPID_ONHOLD_GROWTH",
  "DELIVERY_DETERIORATION",
  "REFUND_SPIKE",
  "RECOVERY_TREND",
  "THRESHOLD_FLAPPING",
] as const;

export function unconfiguredCategoricalTrends() {
  return UNCONFIGURED_CATEGORICAL_TRENDS.map((signal) => ({
    signal,
    status: "NOT_EVALUATED" as const,
    reasonCode: "POLICY_UNCONFIGURED" as const,
    comparisons: [],
  }));
}

const PERIOD_KEYS: readonly ObjectiveAnalyticalPeriodKey[] = [
  "TODAY",
  "7D",
  "30D",
  "12M",
  "ALL_AVAILABLE",
];

/**
 * Resolves analytical history at Bangkok calendar boundaries. All Available
 * preserves the observed source boundary and intentionally has no invented
 * prior period for a delta.
 */
export function resolveObjectiveAnalyticalPeriods(
  input: ResolveObjectiveAnalyticalPeriodsInput,
): readonly ObjectiveAnalyticalPeriod[] {
  const observationEnd = resolveAnalyticalDeliveryPeriod("TODAY", input.now).end!;
  return PERIOD_KEYS.map((key) => {
    const period = resolveAnalyticalDeliveryPeriod(key, input.now);
    if (key === "ALL_AVAILABLE") {
      return input.firstAvailableAt === null
        ? {
            key,
            label: period.label,
            start: null,
            end: observationEnd,
            comparison: null,
            deltaStatus: "NOT_EVALUATED",
            deltaReason: "NO_PERSISTED_SOURCE_DATA",
          }
        : {
            key,
            label: period.label,
            start: input.firstAvailableAt,
            end: observationEnd,
            comparison: null,
            deltaStatus: "NOT_EVALUATED",
            deltaReason: "ALL_AVAILABLE_HAS_NO_COMPARABLE_BASELINE",
          };
    }
    const start = period.start!;
    const duration = period.end!.getTime() - start.getTime();
    return {
      key,
      label: period.label,
      start,
      end: period.end!,
      comparison: {
        start: new Date(start.getTime() - duration),
        end: start,
      },
      deltaStatus: "EVALUATED",
      deltaReason: null,
    };
  });
}
