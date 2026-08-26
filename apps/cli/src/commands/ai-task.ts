import { appendAiTaskConfigRevision, getCurrentAiTaskConfig } from "@shop-health/db";
import type { Command } from "commander";

import { withDatabase } from "../db-runtime.js";
import { printJson, printKeyValues } from "../presentation/output.js";
import type { CliRuntime } from "../runtime.js";

const TASK_IDS = ["SHOP_HEALTH_REVIEWER", "FINANCE_SPECIALIST", "ORDER_ANOMALY_REVIEWER", "BA_ASSISTANT"] as const;

type TaskId = typeof TASK_IDS[number];
interface WriteOptions { readonly effectiveFrom: string; readonly payload: string; readonly json?: boolean; }
interface ReadOptions { readonly effectiveAt: string; readonly json?: boolean; }

function parseTaskId(value: string): TaskId {
  if ((TASK_IDS as readonly string[]).includes(value)) return value as TaskId;
  throw new Error(`Unknown AI task ID: ${value}`);
}

function parseDate(value: string, option: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  const invalid = `${option} must be an ISO timestamp with an explicit UTC or offset`;
  if (match === null) throw new Error(invalid);
  const [, year, month, day, hour, minute, second] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  if (
    calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1
    || calendar.getUTCDate() !== Number(day) || calendar.getUTCHours() !== Number(hour)
    || calendar.getUTCMinutes() !== Number(minute) || calendar.getUTCSeconds() !== Number(second)
  ) throw new Error(invalid);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(invalid);
  return date;
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const payload: unknown = JSON.parse(value);
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
    return payload as Record<string, unknown>;
  } catch {
    throw new Error("--payload must be a JSON object");
  }
}

function outputRevision(revision: {
  revisionId: string; sequence: bigint; taskId: string; enabled: boolean; status: string; effectiveFrom: Date;
}, json: boolean | undefined): void {
  const safe = { ...revision, sequence: revision.sequence.toString(), effectiveFrom: revision.effectiveFrom.toISOString() };
  if (json) printJson({ schemaVersion: "ai-task-config-revision.v1", revision: safe });
  else printKeyValues([
    ["Task", revision.taskId], ["Revision ID", revision.revisionId], ["Sequence", String(revision.sequence)],
    ["Enabled", String(revision.enabled)], ["Status", revision.status], ["Effective From", revision.effectiveFrom.toISOString()],
  ]);
}

export function registerAiTaskCommands(program: Command, runtime: CliRuntime): void {
  const task = program.command("ai-task").description("Manage immutable AI task configuration revisions");
  task.command("set <taskId>")
    .requiredOption("--effective-from <timestamp>")
    .requiredOption("--payload <json>")
    .option("--json")
    .action(async (taskId: string, options: WriteOptions) => {
      const revision = await withDatabase(runtime, ({ db }) => appendAiTaskConfigRevision(db, {
        ...parsePayload(options.payload),
        taskId: parseTaskId(taskId),
        effectiveFrom: parseDate(options.effectiveFrom, "--effective-from"),
      } as Parameters<typeof appendAiTaskConfigRevision>[1]));
      outputRevision(revision, options.json);
    });
  task.command("read-effective <taskId>")
    .requiredOption("--effective-at <timestamp>")
    .option("--json")
    .action(async (taskId: string, options: ReadOptions) => {
      const current = await withDatabase(runtime, ({ db }) => getCurrentAiTaskConfig(db, {
        taskId: parseTaskId(taskId),
        effectiveAt: parseDate(options.effectiveAt, "--effective-at"),
      }));
      if (options.json) printJson({ schemaVersion: "ai-task-config-current.v1", taskId, config: current });
      else printKeyValues([["Task", taskId], ["Current Revision", current?.revisionId ?? "-"], ["Status", current?.status ?? "UNSET"]]);
    });
}
