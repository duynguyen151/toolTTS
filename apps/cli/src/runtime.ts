import pino, { type Logger } from "pino";

import type { CliConfig } from "./config.js";
import { CliError } from "./errors.js";

export interface CliRuntime {
  readonly config: CliConfig;
  readonly logger: Logger;
}

export function createCliRuntime(config: CliConfig): CliRuntime {
  return {
    config,
    logger: pino({
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          "cookie",
          "cookies",
          "token",
          "headers.cookie",
          "headers.authorization",
          "session",
          "storageState"
        ],
        censor: "[REDACTED]"
      }
    })
  };
}

export function requireDatabaseUrl(runtime: CliRuntime): string {
  const databaseUrl = runtime.config.DATABASE_URL;
  if (databaseUrl === undefined) {
    throw new CliError({
      failureType: "DATABASE_NOT_CONFIGURED",
      message: "DATABASE_URL is required for this command"
    });
  }
  return databaseUrl;
}

export function requireCotikToken(runtime: CliRuntime): string {
  const token = runtime.config.COTIK_TOKEN?.trim();
  if (!token) {
    throw new CliError({
      failureType: "COTIK_NOT_CONFIGURED",
      message: "COTIK_TOKEN is required for this command"
    });
  }
  return token;
}
