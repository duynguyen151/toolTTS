import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADSPOWER_BASE_URL: z.string().url().default("http://127.0.0.1:50325"),
  ADSPOWER_API_KEY: z.string().optional(),
  ADSPOWER_AUTOFILL_REFERENCE: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  ORDERS_PROBE_INTERVAL_MS: z.coerce.number().int().min(5_000).default(10_000),
  FINANCE_PROBE_INTERVAL_MS: z.coerce.number().int().min(10_000).default(20_000)
});

export type WorkerConfig = z.infer<typeof configSchema>;

export function loadWorkerConfig(): WorkerConfig {
  return configSchema.parse(process.env);
}
