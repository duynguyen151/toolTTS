import {
  addRefreshCheckpoint,
  deleteRefreshCheckpoint,
  getCurrentRefreshSettings,
  setAutoRefreshEnabled,
  setRefreshCheckpointEnabled,
  setRefreshRetryOffsets,
  updateRefreshCheckpoint,
} from "@shop-health/db";
import type { Command } from "commander";

import { withDatabase } from "../db-runtime.js";
import { CliError } from "../errors.js";
import { printJson, printKeyValues, printTable } from "../presentation/output.js";
import type { CliRuntime } from "../runtime.js";

interface JsonOption { readonly json?: boolean; }
interface RetryOptions extends JsonOption { readonly offsets: string; }

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("value must be exactly true or false");
}

function parseTime(value: string): string {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error("time must be an exact HH:mm value in Asia/Bangkok");
  }
  return value;
}

function parseOffsets(value: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("--offsets must be a JSON array of integer minutes");
  }
  if (
    !Array.isArray(parsed)
    || parsed.length === 0
    || parsed.length > 10
    || parsed.some((offset) => typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset > 1_440)
    || new Set(parsed).size !== parsed.length
  ) {
    throw new Error("--offsets must be a unique JSON array of bounded integer minutes");
  }
  return parsed;
}

function checkpointJson(checkpoint: {
  id: string;
  localTime: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...checkpoint,
    createdAt: checkpoint.createdAt.toISOString(),
    updatedAt: checkpoint.updatedAt.toISOString(),
  };
}

function settingsJson(settings: Awaited<ReturnType<typeof getCurrentRefreshSettings>>) {
  return {
    ...settings,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
    checkpoints: settings.checkpoints.map(checkpointJson),
  };
}

function outputSettings(settings: Awaited<ReturnType<typeof getCurrentRefreshSettings>>, json: boolean | undefined): void {
  if (json === true) {
    printJson({ schemaVersion: "refresh-settings-current.v1", settings: settingsJson(settings) });
    return;
  }
  printKeyValues([
    ["Auto Refresh", String(settings.autoRefreshEnabled)],
    ["Retry Offsets (minutes)", JSON.stringify(settings.retryOffsetsMinutes)],
    ["Time Zone", settings.timeZone],
    ["Revision", String(settings.revision)],
  ]);
  printTable(["ID", "Time (Asia/Bangkok)", "Enabled"], settings.checkpoints.map((checkpoint) => [
    checkpoint.id,
    checkpoint.localTime,
    String(checkpoint.enabled),
  ]));
}

function outputResult(value: unknown, json: boolean | undefined, schemaVersion: string): void {
  if (json) printJson({ schemaVersion, result: value });
  else printKeyValues([["Result", "OK"]]);
}

export function registerRefreshSettingsCommands(program: Command, runtime: CliRuntime): void {
  const settings = program.command("refresh-settings").description("Manage persisted auto-refresh settings and checkpoints");
  settings.command("show")
    .option("--json")
    .action(async (options: JsonOption) => {
      const current = await withDatabase(runtime, ({ db }) => getCurrentRefreshSettings(db));
      outputSettings(current, options.json);
    });
  settings.command("set-auto <enabled>")
    .option("--json")
    .action(async (enabled: string, options: JsonOption) => {
      const result = await withDatabase(runtime, ({ db }) => setAutoRefreshEnabled(db, { enabled: parseBoolean(enabled) }));
      outputResult(options.json ? settingsJson(result) : result, options.json, "refresh-settings-updated.v1");
    });
  settings.command("set-retries")
    .requiredOption("--offsets <json>")
    .option("--json")
    .action(async (options: RetryOptions) => {
      const result = await withDatabase(runtime, ({ db }) => setRefreshRetryOffsets(db, { retryOffsets: parseOffsets(options.offsets) }));
      outputResult(options.json ? settingsJson(result) : result, options.json, "refresh-settings-updated.v1");
    });

  const checkpoint = settings.command("checkpoint").description("Manage refresh checkpoints");
  checkpoint.command("add <time>")
    .option("--disabled")
    .option("--json")
    .action(async (time: string, options: { disabled?: boolean; json?: boolean }) => {
      const result = await withDatabase(runtime, ({ db }) => addRefreshCheckpoint(db, {
        localTime: parseTime(time),
        enabled: options.disabled !== true,
      }));
      outputResult(options.json ? checkpointJson(result) : result, options.json, "refresh-checkpoint-created.v1");
    });
  checkpoint.command("edit <id> <time>")
    .option("--json")
    .action(async (id: string, time: string, options: JsonOption) => {
      const result = await withDatabase(runtime, ({ db }) => updateRefreshCheckpoint(db, {
        checkpointId: id,
        localTime: parseTime(time),
      }));
      if (result === null) throw new CliError({ failureType: "REFRESH_CHECKPOINT_NOT_FOUND", message: `Refresh checkpoint ${id} was not found` });
      outputResult(options.json ? checkpointJson(result) : result, options.json, "refresh-checkpoint-updated.v1");
    });
  for (const [verb, enabled] of [["enable", true], ["disable", false]] as const) {
    checkpoint.command(`${verb} <id>`)
      .option("--json")
      .action(async (id: string, options: JsonOption) => {
        const result = await withDatabase(runtime, ({ db }) => setRefreshCheckpointEnabled(db, { checkpointId: id, enabled }));
        if (result === null) throw new CliError({ failureType: "REFRESH_CHECKPOINT_NOT_FOUND", message: `Refresh checkpoint ${id} was not found` });
        outputResult(options.json ? checkpointJson(result) : result, options.json, "refresh-checkpoint-updated.v1");
      });
  }
  checkpoint.command("delete <id>")
    .option("--json")
    .action(async (id: string, options: JsonOption) => {
      const deleted = await withDatabase(runtime, ({ db }) => deleteRefreshCheckpoint(db, { checkpointId: id }));
      if (!deleted) throw new CliError({ failureType: "REFRESH_CHECKPOINT_NOT_FOUND", message: `Refresh checkpoint ${id} was not found` });
      outputResult(options.json ? { deleted: true, id } : deleted, options.json, "refresh-checkpoint-deleted.v1");
    });
}
