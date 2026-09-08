import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  COTIK_DEPLOY_VERSION: z.string().trim().min(1).optional(),
  ADSPOWER_BASE_URL: z.string().url().default("http://127.0.0.1:50325"),
  ADSPOWER_API_KEY: z.string().optional(),
  ADSPOWER_AUTOFILL_REFERENCE: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/).optional(),
  COTIK_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DISPLAY_TIME_ZONE: z.string().default("Asia/Bangkok")
});

export type CliConfig = z.infer<typeof configSchema>;

export function getWorkspaceEnvPath(moduleUrl: string = import.meta.url): string {
  return fileURLToPath(new URL("../../../.env", moduleUrl));
}

export function loadWorkspaceEnvironment(): void {
  loadDotenv({ path: getWorkspaceEnvPath(), quiet: true });
}

export function loadConfig(): CliConfig {
  return configSchema.parse(process.env);
}
