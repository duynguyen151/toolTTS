import { z } from "zod";

import { EvaluationStatusSchema } from "./contracts/common.js";
import { MetricsResultSchema, type MetricsResult } from "./metrics/types.js";
import {
  HealthEvaluationSchema,
  type HealthEvaluation,
} from "./recommendation/evaluate.js";

export const SHOP_REPORT_SCHEMA_VERSION = "shop-report.v1" as const;

export const ShopReportSchema = z.object({
  schemaVersion: z.literal(SHOP_REPORT_SCHEMA_VERSION),
  generatedAt: z.string().datetime(),
  shop: z.object({
    id: z.string().min(1),
    profileNo: z.string().min(1),
    displayName: z.string().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  dataStatus: EvaluationStatusSchema,
  period: z.object({
    label: z.string().min(1),
    currentStart: z.string().datetime(),
    currentEnd: z.string().datetime(),
    previousStart: z.string().datetime(),
    previousEnd: z.string().datetime(),
  }),
  metrics: MetricsResultSchema,
  health: HealthEvaluationSchema,
});

export type ShopReport = z.infer<typeof ShopReportSchema>;

export interface BuildShopReportInput {
  generatedAt: Date;
  shop: ShopReport["shop"];
  dataStatus: ShopReport["dataStatus"];
  period: {
    label: string;
    currentStart: Date;
    currentEnd: Date;
    previousStart: Date;
    previousEnd: Date;
  };
  metrics: MetricsResult;
  health: HealthEvaluation;
}

export function buildShopReport(input: BuildShopReportInput): ShopReport {
  return ShopReportSchema.parse({
    schemaVersion: SHOP_REPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt.toISOString(),
    shop: input.shop,
    dataStatus: input.dataStatus,
    period: {
      label: input.period.label,
      currentStart: input.period.currentStart.toISOString(),
      currentEnd: input.period.currentEnd.toISOString(),
      previousStart: input.period.previousStart.toISOString(),
      previousEnd: input.period.previousEnd.toISOString(),
    },
    metrics: input.metrics,
    health: input.health,
  });
}
