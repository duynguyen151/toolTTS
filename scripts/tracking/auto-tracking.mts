#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import {
  AUTO_TRACKING_CAPABILITY,
  AUTO_TRACKING_SCHEMA_VERSION,
  createAutoTrackingCapability
} from "../apps/cli/src/cotik-tracking-workflow.js";
import { parseAutoTrackingRequest, type AutoTrackingRequest } from "../apps/cli/src/cotik-tracking-contract.js";
import { loadConfig, loadWorkspaceEnvironment } from "../apps/cli/src/config.js";
import { toCliErrorPayload } from "../apps/cli/src/errors.js";
import { createCliRuntime } from "../apps/cli/src/runtime.js";

async function readRequest(): Promise<AutoTrackingRequest> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) chunks.push(String(chunk));
  const raw = chunks.join("");
  if (raw.trim().length === 0) throw new Error("A JSON request is required on stdin");
  return parseAutoTrackingRequest(raw);
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  loadWorkspaceEnvironment();
  try {
    const request = await readRequest();
    const runtime = createCliRuntime(loadConfig());
    const capability = createAutoTrackingCapability(runtime);
    const response = request.action === "status"
      ? await capability.status()
      : request.action === "stop"
        ? await capability.stop()
        : await capability.execute(request.input);
    writeJson(response);
  } catch (error) {
    writeJson({
      schemaVersion: AUTO_TRACKING_SCHEMA_VERSION,
      capability: AUTO_TRACKING_CAPABILITY,
      error: toCliErrorPayload(error)
    });
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
