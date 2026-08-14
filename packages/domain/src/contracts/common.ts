import { z } from "zod";

export const DecimalStringSchema = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/, "Expected a decimal string");

export const NonNegativeDecimalStringSchema = DecimalStringSchema.refine(
  (value) => !value.startsWith("-"),
  "Expected a non-negative decimal string",
);

export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

export const JsonObjectSchema = z.record(z.string(), z.unknown());

export const DateRangeSchema = z
  .object({
    start: z.date(),
    end: z.date(),
  })
  .refine(({ start, end }) => start < end, {
    message: "Date range start must be before end",
  });

export type DateRange = z.infer<typeof DateRangeSchema>;

export const EvaluationStatusSchema = z.enum([
  "FRESH",
  "STALE",
  "ERROR",
  "INSUFFICIENT_DATA",
]);

export type EvaluationStatus = z.infer<typeof EvaluationStatusSchema>;
