import {
  resolveAiTaskConfig,
  testAiTaskConnection,
  type AiConnectionResult,
  type ResolvedAiTaskConfig,
} from "@shop-health/decision-ai";
import { appendAiTaskConfigRevision, getCurrentAiTaskConfig } from "@shop-health/db";
import type { Command } from "commander";

import { withDatabase } from "../db-runtime.js";
import { printJson, printKeyValues } from "../presentation/output.js";
import type { CliRuntime } from "../runtime.js";

const TASK_IDS = ["SHOP_HEALTH_REVIEWER", "FINANCE_SPECIALIST", "ORDER_ANOMALY_REVIEWER", "BA_ASSISTANT"] as const;

type TaskId = typeof TASK_IDS[number];
interface WriteOptions { readonly effectiveFrom: string; readonly payload: string; readonly json?: boolean; }
interface ReadOptions { readonly effectiveAt: string; readonly json?: boolean; }

interface TestOptions extends ReadOptions {}

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

type AiTaskConfigJson = {
  readonly revisionId: string;
  readonly sequence: string;
  readonly taskId: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly parameters: { readonly timeoutMs?: number | undefined };
  readonly secretRef: string;
  readonly enabled: boolean;
  readonly status: string;
  readonly effectiveFrom: string;
  readonly createdAt: string;
};

function serializeAiTaskConfig(config: {
  revisionId: string; sequence: bigint; taskId: string; provider: string; baseUrl: string; model: string;
  parameters: { readonly timeoutMs?: number | undefined }; secretRef: string; enabled: boolean; status: string;
  effectiveFrom: Date; createdAt: Date;
}): AiTaskConfigJson {
  return {
    revisionId: config.revisionId,
    sequence: config.sequence.toString(),
    taskId: config.taskId,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    parameters: config.parameters,
    secretRef: config.secretRef,
    enabled: config.enabled,
    status: config.status,
    effectiveFrom: config.effectiveFrom.toISOString(),
    createdAt: config.createdAt.toISOString(),
  };
}

function outputRevision(revision: {
  revisionId: string; sequence: bigint; taskId: string; provider: string; baseUrl: string; model: string;
  parameters: { readonly timeoutMs?: number | undefined }; secretRef: string; enabled: boolean; status: string;
  effectiveFrom: Date; createdAt: Date;
}, json: boolean | undefined): void {
  if (json) printJson({ schemaVersion: "ai-task-config-revision.v1", revision: serializeAiTaskConfig(revision) });
  else printKeyValues([
    ["Task", revision.taskId], ["Revision ID", revision.revisionId], ["Sequence", String(revision.sequence)],
    ["Enabled", String(revision.enabled)], ["Status", revision.status], ["Effective From", revision.effectiveFrom.toISOString()],
  ]);
}

function connectionConfiguration(
  config: ResolvedAiTaskConfig,
  current: { readonly revisionId: string } | null,
): { readonly source: ResolvedAiTaskConfig["source"]; readonly revisionId: string | null } {
  return {
    source: config.source,
    revisionId: config.source === "PERSISTED" ? current?.revisionId ?? null : null,
  };
}

function outputConnectionTest(input: {
  readonly taskId: TaskId;
  readonly effectiveAt: Date;
  readonly config: ResolvedAiTaskConfig;
  readonly current: { readonly revisionId: string } | null;
  readonly connection: AiConnectionResult;
  readonly json: boolean | undefined;
}): void {
  const payload = {
    schemaVersion: "ai-task-connection.v1" as const,
    taskId: input.taskId,
    effectiveAt: input.effectiveAt.toISOString(),
    configuration: connectionConfiguration(input.config, input.current),
    connection: input.connection,
  };
  if (input.json) {
    printJson(payload);
    return;
  }
  printKeyValues([
    ["Task", payload.taskId],
    ["Effective At", payload.effectiveAt],
    ["Configuration Source", payload.configuration.source],
    ["Connection", payload.connection.status],
    ["Code", payload.connection.code],
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
      if (options.json) printJson({
        schemaVersion: "ai-task-config-current.v1",
        taskId,
        config: current === null ? null : serializeAiTaskConfig(current),
      });
      else printKeyValues([["Task", taskId], ["Current Revision", current?.revisionId ?? "-"], ["Status", current?.status ?? "UNSET"]]);
    });
  task.command("test <taskId>")
    .requiredOption("--effective-at <timestamp>")
    .option("--json")
    .action(async (taskId: string, options: TestOptions) => {
      const parsedTaskId = parseTaskId(taskId);
      const effectiveAt = parseDate(options.effectiveAt, "--effective-at");
      const current = await withDatabase(runtime, ({ db }) => getCurrentAiTaskConfig(db, {
        taskId: parsedTaskId,
        effectiveAt,
      }));
      const config = resolveAiTaskConfig(parsedTaskId, current, process.env);
      const connection = await testAiTaskConnection(config, { environment: process.env });
      outputConnectionTest({
        taskId: parsedTaskId,
        effectiveAt,
        config,
        current,
        connection,
        json: options.json,
      });
    });
}
