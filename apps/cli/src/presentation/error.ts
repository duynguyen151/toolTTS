import type { CliErrorPayload } from "../errors.js";
import { printJson } from "./output.js";

export function printError(payload: CliErrorPayload, json: boolean): void {
  if (json) {
    printJson({ error: payload });
    return;
  }

  process.stderr.write(`[${payload.failureType}] ${payload.message}\n`);
  if (payload.details !== undefined) {
    for (const [key, value] of Object.entries(payload.details)) {
      process.stderr.write(`  ${key}: ${String(value)}\n`);
    }
  }
}
