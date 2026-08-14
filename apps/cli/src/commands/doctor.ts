import { pingDatabase, createDatabase, closeDatabase } from "@shop-health/db";
import type { Command } from "commander";

import type { CliRuntime } from "../runtime.js";
import { printJson, printTable } from "../presentation/output.js";

interface DoctorOptions {
  readonly json?: boolean;
}

export function registerDoctorCommand(program: Command, runtime: CliRuntime): void {
  program
    .command("doctor")
    .description("Check local runtime, AdsPower, and PostgreSQL connectivity")
    .option("--json", "Print stable JSON output")
    .action(async (options: DoctorOptions) => {
      const checks: Array<{ name: string; status: "OK" | "FAIL" | "SKIP"; detail: string }> = [];
      checks.push({ name: "node", status: "OK", detail: process.version });

      try {
        const requestInit: RequestInit = {
          signal: AbortSignal.timeout(5_000),
        };
        if (runtime.config.ADSPOWER_API_KEY !== undefined) {
          requestInit.headers = { Authorization: `Bearer ${runtime.config.ADSPOWER_API_KEY}` };
        }
        const response = await fetch(`${runtime.config.ADSPOWER_BASE_URL}/status`, requestInit);
        checks.push({
          name: "adspower",
          status: response.ok ? "OK" : "FAIL",
          detail: `HTTP ${response.status}`
        });
      } catch (error) {
        checks.push({
          name: "adspower",
          status: "FAIL",
          detail: error instanceof Error ? error.message : "Unknown error"
        });
      }

      if (runtime.config.DATABASE_URL === undefined) {
        checks.push({ name: "postgresql", status: "SKIP", detail: "DATABASE_URL is not configured" });
      } else {
        const context = createDatabase(runtime.config.DATABASE_URL);
        try {
          await pingDatabase(context);
          checks.push({ name: "postgresql", status: "OK", detail: "Connection succeeded" });
        } catch (error) {
          checks.push({
            name: "postgresql",
            status: "FAIL",
            detail: error instanceof Error ? error.message : "Unknown error"
          });
        } finally {
          await closeDatabase(context);
        }
      }

      if (options.json === true) printJson({ schemaVersion: "doctor.v1", checks });
      else printTable(["CHECK", "STATUS", "DETAIL"], checks.map((check) => [check.name, check.status, check.detail]));

      if (checks.some((check) => check.status === "FAIL")) process.exitCode = 1;
    });
}
