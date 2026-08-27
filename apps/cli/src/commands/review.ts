import {
  BaDecisionInputSchema,
  BaDecisionReasonCodeSchema,
  BaDecisionSchema,
  BaPlannedMethodSchema,
  type BaDecision,
  type BaDecisionReasonCode,
  type BaDecisionInput,
  type BaPlannedMethod,
} from "@shop-health/domain";
import type { DecisionWorkflow } from "@shop-health/decision-workflow";
import { Command, InvalidArgumentError } from "commander";
import { z } from "zod";

import { formatDecisionHistory, formatDecisionReview } from "../presentation/review.js";

interface ReviewCommandOutput {
  readonly timeZone: string;
  readonly write?: (value: string) => void;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: string, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidArgumentError(`Invalid ${label}: ${value}`);
  return parsed.data;
}

const uuidSchema = z.string().uuid();

function uuid(value: string): string {
  return parseWithSchema(uuidSchema, value, "UUID");
}

function decision(value: string): BaDecision {
  return parseWithSchema(BaDecisionSchema, value, "BA decision");
}

function reasonCode(value: string, previous: BaDecisionReasonCode[]): BaDecisionReasonCode[] {
  return [...previous, parseWithSchema(BaDecisionReasonCodeSchema, value, "BA reason code")];
}

function plannedMethod(value: string, previous: BaPlannedMethod[]): BaPlannedMethod[] {
  return [...previous, parseWithSchema(BaPlannedMethodSchema, value, "SLOW_SELL planned method")];
}

function confidence(value: string): number {
  return parseWithSchema(z.coerce.number().min(0).max(1), value, "confidence");
}

function limit(value: string): number {
  return parseWithSchema(z.coerce.number().int().min(1).max(100), value, "limit");
}

export function registerReviewCommands(
  program: Command,
  workflow: DecisionWorkflow,
  output: ReviewCommandOutput,
): void {
  const write = output.write ?? ((value: string) => process.stdout.write(value));
  const review = program.command("review").description("Review persisted shop decisions");

  review.command("start <profileNo>")
    .option("--request-id <uuid>", "Idempotency request UUID", uuid)
    .option("--json", "Print stable JSON output")
    .action(async (profileNo: string, options: { requestId?: string; json?: boolean }) => {
      const view = await workflow.startReview({
        profileNo,
        ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      });
      write(options.json === true
        ? `${JSON.stringify(view, null, 2)}\n`
        : formatDecisionReview(view, output.timeZone));
    });

  review.command("show <caseId>")
    .option("--json", "Print stable JSON output")
    .action(async (caseId: string, options: { json?: boolean }) => {
      const view = await workflow.show(uuid(caseId));
      write(options.json === true
        ? `${JSON.stringify(view, null, 2)}\n`
        : formatDecisionReview(view, output.timeZone));
    });

  review.command("decide <caseId>")
    .requiredOption("--decision <decision>", "SCALE, CONTINUE, WATCH, PAUSE, or SLOW_SELL", decision)
    .requiredOption("--reason-code <code>", "Repeatable BA reason code", reasonCode, [])
    .option("--confidence <number>", "Confidence from 0 through 1", confidence)
    .option("--note <text>", "Optional BA note")
    .option("--notes <text>", "Optional BA notes; required for OTHER planned method")
    .option("--planned-method <method>", "Repeatable SLOW_SELL method", plannedMethod, [])
    .option("--request-id <uuid>", "Idempotency request UUID", uuid)
    .option("--json", "Print stable JSON output")
    .action(async (caseId: string, options: {
      decision: BaDecision;
      reasonCode: BaDecisionReasonCode[];
      confidence?: number;
      note?: string;
      notes?: string;
      plannedMethod: BaPlannedMethod[];
      requestId?: string;
      json?: boolean;
    }) => {
      const baInput = BaDecisionInputSchema.parse({
        decision: options.decision,
        reasonCode: options.reasonCode[0],
        reasonCodes: options.reasonCode,
        ...(options.confidence === undefined ? {} : { confidence: options.confidence }),
        ...(options.note === undefined ? {} : { note: options.note }),
        ...(options.notes === undefined ? {} : { notes: options.notes }),
        ...(options.plannedMethod.length === 0 ? {} : { plannedMethods: options.plannedMethod }),
      }) satisfies BaDecisionInput;
      const view = await workflow.decide({
        caseId: uuid(caseId),
        decision: baInput.decision,
        reasonCode: baInput.reasonCode,
        ...(baInput.reasonCodes === undefined ? {} : { reasonCodes: baInput.reasonCodes }),
        ...(baInput.confidence === undefined ? {} : { confidence: baInput.confidence }),
        ...(baInput.plannedMethods === undefined ? {} : { plannedMethods: baInput.plannedMethods }),
        ...(baInput.note === undefined ? {} : { note: baInput.note }),
        ...(baInput.notes === undefined ? {} : { notes: baInput.notes }),
        ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      });
      write(options.json === true
        ? `${JSON.stringify(view, null, 2)}\n`
        : formatDecisionReview(view, output.timeZone));
    });

  review.command("execute <caseId>")
    .requiredOption("--confirm", "Confirm Holiday Mode DRY_RUN simulation")
    .option("--request-id <uuid>", "Idempotency request UUID", uuid)
    .option("--json", "Print stable JSON output")
    .action(async (caseId: string, options: { confirm: true; requestId?: string; json?: boolean }) => {
      const view = await workflow.execute({
        caseId: uuid(caseId),
        confirm: options.confirm,
        ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      });
      write(options.json === true
        ? `${JSON.stringify(view, null, 2)}\n`
        : formatDecisionReview(view, output.timeZone));
    });

  review.command("history <profileNo>")
    .option("--limit <count>", "Cases per page, 1 through 100", limit, 20)
    .option("--cursor <cursor>", "Opaque pagination cursor")
    .option("--json", "Print stable JSON output")
    .action(async (profileNo: string, options: { limit: number; cursor?: string; json?: boolean }) => {
      const page = await workflow.history({
        profileNo,
        limit: options.limit,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      });
      write(options.json === true
        ? `${JSON.stringify(page, null, 2)}\n`
        : formatDecisionHistory(page, output.timeZone));
    });
}
