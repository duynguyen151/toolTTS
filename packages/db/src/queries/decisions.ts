import {
  AiDecisionInputSchema,
  CaptureBaDecisionInputSchema,
  CreateDecisionCaseInputSchema,
  DecisionCoverageSnapshotSchema,
  DecisionFinanceSnapshotSchema,
  DecisionMetricsSnapshotSchema,
  DecisionRiskSnapshotSchema,
  RecordBaDecisionForCaseInputSchema,
  RecordDryRunExecutionInputSchema,
  type AiDecisionInput,
  type BaDecision,
  type BaDecisionReasonCode,
  type CaptureBaDecisionInput,
  type CreateDecisionCaseInput,
  type DecisionDataCoverage,
  type DecisionDataOrigin,
  type DecisionCoverageSnapshot,
  type DecisionFinanceSnapshot,
  type DecisionMetricsSnapshot,
  type DecisionRiskSnapshot,
  type DecisionRuleResult,
  type DecisionRuleTrigger,
  type RecordBaDecisionForCaseInput,
  type RecordDryRunExecutionInput,
} from "@shop-health/domain";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "../client.js";
import {
  aiDecisions,
  baDecisions,
  decisionCases,
  decisionExecutions,
  shops,
  type AiDecisionRow,
  type BaDecisionRow,
  type DecisionCaseRow,
  type DecisionExecutionRow,
  type ShopRow,
} from "../schema.js";

export type {
  AiDecisionInput,
  BaDecisionInput,
  CaptureBaDecisionInput,
  CreateDecisionCaseInput,
  DecisionCaseInput,
  RecordBaDecisionForCaseInput,
  RecordDryRunExecutionInput,
} from "@shop-health/domain";

export interface CapturedBaDecision {
  decisionCase: DecisionCaseRow;
  baDecision: BaDecisionRow;
}

export interface DecisionReviewRecord {
  case: { id: string; origin: DecisionDataOrigin; observedAt: Date; createdAt: Date };
  shop: {
    id: string;
    profileNo: string;
    displayName: string;
    currency: string;
    dataOrigin: DecisionDataOrigin;
    dataCoverage: DecisionDataCoverage;
    lastSyncAt: Date | null;
  };
  coverageSnapshot: DecisionCoverageSnapshot;
  metrics: {
    totalOrders: number;
    onHoldValue: string | null;
    deliveredCount: number | null;
    deliveryRate: number | null;
    cancellationRate: number | null;
    refundRate: number | null;
    currency: string;
    unavailableReasons: {
      onHoldValue: string;
      deliveredCount: string;
      deliveryRate: string;
      cancellationRate: string;
      refundRate: string;
    };
  };
  rule: {
    decision: DecisionRuleResult;
    triggers: DecisionRuleTrigger[];
    expression: string;
    policyVersion: string;
    thresholds: {
      stopOnHoldValueAt: string;
      stopDeliveryRateBelow: number;
      minimumOrdersForRateRule: number;
    };
  };
  ai:
    | {
        status: "AVAILABLE";
        recommendation: BaDecision;
        riskLevel: "LOW" | "MEDIUM" | "HIGH" | null;
        confidence: number;
        ruleOverride: boolean | null;
        reasonCodes: BaDecisionReasonCode[];
        supportingFactors: string[] | null;
        riskFactors: string[] | null;
        whatWouldChangeDecision: string[] | null;
        reason: string;
        humanReviewRequired: boolean;
        provider: string;
        model: string | null;
        requestedModel: string | null;
        reportedModel: string | null;
        actualModelUsed: string | null;
        authMode: "LOCAL_NO_AUTH" | "BEARER" | "CONFIG_MISSING" | null;
        outputSchemaVersion: string | null;
        promptVersion: string;
        policyVersion: string;
        aiPolicyVersion: string | null;
        createdAt: Date;
      }
    | {
      status: "UNAVAILABLE";
        recommendation: null;
        riskLevel: null;
        confidence: null;
        ruleOverride: null;
        reasonCodes: null;
        supportingFactors: null;
        riskFactors: null;
        whatWouldChangeDecision: null;
        reason: null;
        failureCode: string;
        humanReviewRequired: true;
        provider: string;
        model: string | null;
        requestedModel: string | null;
        reportedModel: string | null;
        actualModelUsed: string | null;
        authMode: "LOCAL_NO_AUTH" | "BEARER" | "CONFIG_MISSING" | null;
        outputSchemaVersion: string | null;
        promptVersion: string;
        policyVersion: string;
        aiPolicyVersion: string | null;
        createdAt: Date;
      }
    | null;
  ba: {
    id: string;
    decision: BaDecision;
    reasonCode: BaDecisionReasonCode;
    confidence: number | null;
    reasonCodes: BaDecisionReasonCode[];
    note: string | null;
    notes: string | null;
    actor: string;
    decidedAt: Date;
  } | null;
  execution: {
    id: string;
    baDecisionId: string;
    requestedAction: "HOLIDAY_MODE_ON";
    mode: "DRY_RUN";
    status: "SIMULATED";
    sellerCenterCalled: false;
    executedAt: Date;
  } | null;
  events: Array<{
    type: "CASE_STARTED" | "AI_RECORDED" | "BA_DECIDED" | "DRY_RUN_EXECUTED";
    occurredAt: Date;
  }>;
}

export interface DecisionHistoryPageRecord {
  items: DecisionReviewRecord[];
  nextCursor: string | null;
}

export interface DecisionAiInputRecord {
  metricsSnapshot: DecisionMetricsSnapshot;
  financeSnapshot: DecisionFinanceSnapshot;
  coverageSnapshot: DecisionCoverageSnapshot;
  riskSnapshot: DecisionRiskSnapshot;
  ruleDecision: DecisionRuleResult;
  ruleTriggers: DecisionRuleTrigger[];
}

export interface ListDecisionHistoryInput {
  profileNo: string;
  caseOrigin?: DecisionDataOrigin;
  limit?: number;
  cursor?: string;
}

function requireBaActor(): string {
  const actor = process.env.TOOL_BA_ACTOR?.trim();
  if (!actor) throw new Error("TOOL_BA_ACTOR is required to record a new BA decision");
  return actor;
}

function normalizeBaInput(input: RecordBaDecisionForCaseInput["baDecision"]): {
  reasonCode: BaDecisionReasonCode;
  reasonCodes: BaDecisionReasonCode[];
  note: string | undefined;
} {
  const reasonCode = input.reasonCode;
  if (!reasonCode) throw new Error("BA reasonCode is required");
  return {
    reasonCode,
    reasonCodes: input.reasonCodes ?? [reasonCode],
    note: input.notes ?? input.note,
  };
}

const ListDecisionHistoryInputSchema = z.object({
  profileNo: z.string().trim().min(1),
  caseOrigin: z.enum(["LIVE", "DEMO_SANITIZED"]).default("LIVE"),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).optional(),
}).strict();

const CursorSchema = z.object({
  observedAt: z.string().datetime(),
  id: z.string().uuid(),
});

function encodeCursor(row: DecisionCaseRow): string {
  return Buffer.from(
    JSON.stringify({ observedAt: row.observedAt.toISOString(), id: row.id }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(cursor: string): z.infer<typeof CursorSchema> {
  try {
    return CursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new Error("Invalid decision history cursor");
  }
}

function assertCaseRetryMatches(existing: DecisionCaseRow, input: CreateDecisionCaseInput): void {
  if (
    existing.shopId !== input.shopId ||
    existing.caseOrigin !== input.caseOrigin
  ) {
    throw new Error("Decision case request ID was already used for another shop or origin");
  }
}

export async function createDecisionCase(
  db: Database,
  input: CreateDecisionCaseInput,
): Promise<DecisionCaseRow> {
  const parsed = CreateDecisionCaseInputSchema.parse(input);
  const [created] = await db.insert(decisionCases).values(parsed)
    .onConflictDoNothing({ target: decisionCases.requestId }).returning();
  if (created) return created;

  const [existing] = await db.select().from(decisionCases)
    .where(eq(decisionCases.requestId, parsed.requestId)).limit(1);
  if (!existing) throw new Error("Failed to create decision case");
  assertCaseRetryMatches(existing, parsed);
  return existing;
}

export async function recordAiDecision(
  db: Database,
  input: AiDecisionInput,
): Promise<AiDecisionRow> {
  const parsed = AiDecisionInputSchema.parse(input);
  const [created] = await db.insert(aiDecisions).values({
    ...parsed,
    confidence: parsed.confidence === null ? null : parsed.confidence.toString(),
  }).onConflictDoNothing().returning();
  if (created) return created;

  const [existingForRequest] = await db.select().from(aiDecisions)
    .where(eq(aiDecisions.requestId, parsed.requestId)).limit(1);
  if (existingForRequest) {
    if (existingForRequest.decisionCaseId !== parsed.decisionCaseId) {
      throw new Error("AI request ID was already used for another decision case");
    }
    return existingForRequest;
  }

  const [existingForCase] = await db.select().from(aiDecisions)
    .where(eq(aiDecisions.decisionCaseId, parsed.decisionCaseId)).limit(1);
  if (existingForCase) return existingForCase;
  throw new Error("Failed to record AI decision");
}

export async function getDecisionAiInput(
  db: Database,
  decisionCaseId: string,
): Promise<DecisionAiInputRecord | null> {
  const parsedCaseId = z.string().uuid().parse(decisionCaseId);
  const [decisionCase] = await db.select({
    metricsSnapshot: decisionCases.metricsSnapshot,
    financeSnapshot: decisionCases.financeSnapshot,
    coverageSnapshot: decisionCases.coverageSnapshot,
    riskSnapshot: decisionCases.riskSnapshot,
    ruleDecision: decisionCases.ruleDecision,
    ruleTriggers: decisionCases.ruleTriggers,
    dataCoverage: decisionCases.dataCoverage,
  }).from(decisionCases).where(eq(decisionCases.id, parsedCaseId)).limit(1);
  if (!decisionCase) return null;
  const coverageSnapshot = decisionCase.coverageSnapshot ?? {
    coverageState: decisionCase.dataCoverage,
    persistedMetricsWindow: decisionCase.metricsSnapshot.window,
    provenSourceWindow: null,
    completeWithinSourceWindow: null,
    lifetimeHistoryComplete: null,
  };
  return {
    metricsSnapshot: DecisionMetricsSnapshotSchema.parse(decisionCase.metricsSnapshot),
    financeSnapshot: DecisionFinanceSnapshotSchema.parse({
      ...decisionCase.financeSnapshot,
      officialOnHoldAmount: decisionCase.financeSnapshot.officialOnHoldAmount ?? null,
      waitingForCompletedRefundReturnAmount:
        decisionCase.financeSnapshot.waitingForCompletedRefundReturnAmount ?? null,
    }),
    coverageSnapshot: DecisionCoverageSnapshotSchema.parse(coverageSnapshot),
    riskSnapshot: DecisionRiskSnapshotSchema.parse(decisionCase.riskSnapshot),
    ruleDecision: decisionCase.ruleDecision,
    ruleTriggers: decisionCase.ruleTriggers,
  };
}

export async function recordBaDecisionForCase(
  db: Database,
  input: RecordBaDecisionForCaseInput,
): Promise<BaDecisionRow> {
  const parsed = RecordBaDecisionForCaseInputSchema.parse(input);
  const actor = requireBaActor();
  const ba = normalizeBaInput(parsed.baDecision);
  const [created] = await db.insert(baDecisions).values({
    requestId: parsed.requestId,
    decisionCaseId: parsed.decisionCaseId,
    decision: parsed.baDecision.decision,
    reasonCode: ba.reasonCode,
    confidence: parsed.baDecision.confidence === undefined
      ? null
      : parsed.baDecision.confidence.toString(),
    reasonCodes: ba.reasonCodes,
    note: ba.note ?? null,
    notes: ba.note ?? null,
    actor,
  }).onConflictDoNothing({ target: baDecisions.requestId }).returning();
  if (created) return created;

  const [existing] = await db.select().from(baDecisions)
    .where(eq(baDecisions.requestId, parsed.requestId)).limit(1);
  if (!existing) throw new Error("Failed to record BA decision");
  if (
    existing.decisionCaseId !== parsed.decisionCaseId ||
    existing.decision !== parsed.baDecision.decision ||
    (existing.confidence === null ? undefined : Number(existing.confidence))
      !== parsed.baDecision.confidence ||
    !isDeepStrictEqual(existing.reasonCodes, parsed.baDecision.reasonCodes) ||
    existing.note !== (parsed.baDecision.note ?? null)
  ) {
    throw new Error("BA request ID was already used with different input");
  }
  return existing;
}

export async function recordDryRunExecution(
  db: Database,
  input: RecordDryRunExecutionInput,
): Promise<DecisionExecutionRow> {
  const parsed = RecordDryRunExecutionInputSchema.parse(input);
  return db.transaction(async (transaction) => {
    const [baDecision] = await transaction.select().from(baDecisions).where(and(
      eq(baDecisions.id, parsed.baDecisionId),
      eq(baDecisions.decisionCaseId, parsed.decisionCaseId),
    )).limit(1);
    if (!baDecision) throw new Error("BA decision not found for decision case");
    if (baDecision.decision !== "PAUSE") {
      throw new Error("DRY_RUN execution requires a PAUSE BA decision");
    }

    const [created] = await transaction.insert(decisionExecutions).values({
      ...parsed,
      baDecision: "PAUSE",
      executionStatus: "SIMULATED",
      sellerCenterCalled: false,
    }).onConflictDoNothing({ target: decisionExecutions.requestId }).returning();
    if (created) return created;

    const [existing] = await transaction.select().from(decisionExecutions)
      .where(eq(decisionExecutions.requestId, parsed.requestId)).limit(1);
    if (!existing) throw new Error("A DRY_RUN execution already exists for this decision case");
    if (existing.decisionCaseId !== parsed.decisionCaseId || existing.baDecisionId !== parsed.baDecisionId) {
      throw new Error("Execution request ID was already used for another decision case");
    }
    return existing;
  });
}

function latestDate(left: Date | null, right: Date | null): Date | null {
  if (left === null) return right;
  if (right === null) return left;
  return left > right ? left : right;
}

function makeReview(
  decisionCase: DecisionCaseRow,
  shop: ShopRow,
  aiDecision: AiDecisionRow | undefined,
  baDecision: BaDecisionRow | undefined,
  execution: DecisionExecutionRow | undefined,
): DecisionReviewRecord {
  const metrics = decisionCase.metricsSnapshot;
  const risk = decisionCase.riskSnapshot;
  const coverageSnapshot = decisionCase.coverageSnapshot ?? {
    coverageState: decisionCase.dataCoverage,
    persistedMetricsWindow: metrics.window,
    provenSourceWindow: null,
    completeWithinSourceWindow: null,
    lifetimeHistoryComplete: null,
  };
  const unavailableReason = decisionCase.dataCoverage === "COMPLETE" ? "NOT_CAPTURED" : "DATA_INCOMPLETE";
  const { stopOnHoldValueAt, stopDeliveryRateBelow, minimumOrdersForRateRule } = risk;
  const events: DecisionReviewRecord["events"] = [
    { type: "CASE_STARTED", occurredAt: decisionCase.createdAt },
  ];
  if (aiDecision) events.push({ type: "AI_RECORDED", occurredAt: aiDecision.createdAt });
  if (baDecision) events.push({ type: "BA_DECIDED", occurredAt: baDecision.createdAt });
  if (execution) events.push({ type: "DRY_RUN_EXECUTED", occurredAt: execution.createdAt });
  events.sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());

  return {
    case: {
      id: decisionCase.id,
      origin: decisionCase.caseOrigin,
      observedAt: decisionCase.observedAt,
      createdAt: decisionCase.createdAt,
    },
    shop: {
      id: shop.id,
      profileNo: shop.profileNo,
      displayName: shop.displayName ?? shop.profileNo,
      currency: shop.currency,
      dataOrigin: shop.dataOrigin,
      dataCoverage: decisionCase.dataCoverage,
      lastSyncAt: latestDate(shop.lastOrdersSyncedAt, shop.lastFinanceSyncedAt),
    },
    coverageSnapshot,
    metrics: {
      totalOrders: metrics.totalOrders,
      onHoldValue: metrics.onHoldValue,
      deliveredCount: metrics.deliveredCount,
      deliveryRate: metrics.deliveryRate,
      cancellationRate: metrics.cancellationRate,
      refundRate: metrics.refundRate,
      currency: metrics.currency,
      unavailableReasons: {
        onHoldValue: unavailableReason,
        deliveredCount: unavailableReason,
        deliveryRate: unavailableReason,
        cancellationRate: unavailableReason,
        refundRate: unavailableReason,
      },
    },
    rule: {
      decision: decisionCase.ruleDecision,
      triggers: decisionCase.ruleTriggers,
      expression: `VALUE >= ${stopOnHoldValueAt} ${metrics.currency} OR DELIVERY_RATE < ${stopDeliveryRateBelow * 100}%`,
      policyVersion: risk.policyVersion,
      thresholds: { stopOnHoldValueAt, stopDeliveryRateBelow, minimumOrdersForRateRule },
    },
    ai: !aiDecision
      ? null
      : aiDecision.status === "AVAILABLE"
        ? {
            status: "AVAILABLE",
            recommendation: aiDecision.recommendation!,
            riskLevel: aiDecision.riskLevel,
            confidence: Number(aiDecision.confidence),
            ruleOverride: aiDecision.ruleOverride,
            reasonCodes: aiDecision.reasonCodes!,
            supportingFactors: aiDecision.supportingFactors,
            riskFactors: aiDecision.riskFactors,
            whatWouldChangeDecision: aiDecision.whatWouldChangeDecision,
            reason: aiDecision.reason!,
            humanReviewRequired: aiDecision.humanReviewRequired,
            provider: aiDecision.provider,
            model: aiDecision.model,
            requestedModel: aiDecision.requestedModel,
            reportedModel: aiDecision.reportedModel,
            actualModelUsed: aiDecision.actualModelUsed,
            authMode: aiDecision.authMode,
            outputSchemaVersion: aiDecision.outputSchemaVersion,
            promptVersion: aiDecision.promptVersion,
            policyVersion: aiDecision.policyVersion,
            aiPolicyVersion: aiDecision.aiPolicyVersion,
            createdAt: aiDecision.createdAt,
          }
        : {
            status: "UNAVAILABLE",
            recommendation: null,
            riskLevel: null,
            confidence: null,
            ruleOverride: null,
            reasonCodes: null,
            supportingFactors: null,
            riskFactors: null,
            whatWouldChangeDecision: null,
            reason: null,
            failureCode: aiDecision.failureCode!,
            humanReviewRequired: true,
            provider: aiDecision.provider,
            model: aiDecision.model,
            requestedModel: aiDecision.requestedModel,
            reportedModel: aiDecision.reportedModel,
            actualModelUsed: aiDecision.actualModelUsed,
            authMode: aiDecision.authMode,
            outputSchemaVersion: aiDecision.outputSchemaVersion,
            promptVersion: aiDecision.promptVersion,
            policyVersion: aiDecision.policyVersion,
            aiPolicyVersion: aiDecision.aiPolicyVersion,
            createdAt: aiDecision.createdAt,
          },
    ba: !baDecision ? null : {
      id: baDecision.id,
      decision: baDecision.decision,
      reasonCode: baDecision.reasonCode,
      confidence: baDecision.confidence === null ? null : Number(baDecision.confidence),
      reasonCodes: baDecision.reasonCodes,
      note: baDecision.note,
      notes: baDecision.notes,
      actor: baDecision.actor,
      decidedAt: baDecision.createdAt,
    },
    execution: !execution ? null : {
      id: execution.id,
      baDecisionId: execution.baDecisionId,
      requestedAction: execution.requestedAction,
      mode: execution.executionMode,
      status: execution.executionStatus,
      sellerCenterCalled: false,
      executedAt: execution.createdAt,
    },
    events,
  };
}

export async function getDecisionReview(
  db: Database,
  decisionCaseId: string,
): Promise<DecisionReviewRecord | null> {
  const parsedCaseId = z.string().uuid().parse(decisionCaseId);
  const [base] = await db.select({ decisionCase: decisionCases, shop: shops })
    .from(decisionCases)
    .innerJoin(shops, eq(decisionCases.shopId, shops.id))
    .where(eq(decisionCases.id, parsedCaseId)).limit(1);
  if (!base) return null;

  const [[aiDecision], [baDecision], [execution]] = await Promise.all([
    db.select().from(aiDecisions).where(eq(aiDecisions.decisionCaseId, parsedCaseId)).limit(1),
    db.select().from(baDecisions)
      .where(eq(baDecisions.decisionCaseId, parsedCaseId))
      .orderBy(desc(baDecisions.createdAt), desc(baDecisions.id)).limit(1),
    db.select().from(decisionExecutions)
      .where(eq(decisionExecutions.decisionCaseId, parsedCaseId))
      .orderBy(desc(decisionExecutions.createdAt), desc(decisionExecutions.id)).limit(1),
  ]);
  return makeReview(base.decisionCase, base.shop, aiDecision, baDecision, execution);
}

export async function getDecisionReviewByRequestId(
  db: Database,
  requestId: string,
): Promise<DecisionReviewRecord | null> {
  const parsedRequestId = z.string().uuid().parse(requestId);
  const [decisionCase] = await db.select({ id: decisionCases.id }).from(decisionCases)
    .where(eq(decisionCases.requestId, parsedRequestId)).limit(1);
  return decisionCase ? getDecisionReview(db, decisionCase.id) : null;
}

export async function listDecisionHistory(
  db: Database,
  input: ListDecisionHistoryInput,
): Promise<DecisionHistoryPageRecord> {
  const parsed = ListDecisionHistoryInputSchema.parse(input);
  const cursor = parsed.cursor ? decodeCursor(parsed.cursor) : null;
  const cursorCondition = cursor === null ? undefined : or(
    lt(decisionCases.observedAt, new Date(cursor.observedAt)),
    and(
      eq(decisionCases.observedAt, new Date(cursor.observedAt)),
      lt(decisionCases.id, cursor.id),
    ),
  );
  const rows = await db.select({ decisionCase: decisionCases, shop: shops })
    .from(decisionCases)
    .innerJoin(shops, eq(decisionCases.shopId, shops.id))
    .where(and(
      eq(shops.profileNo, parsed.profileNo),
      eq(decisionCases.caseOrigin, parsed.caseOrigin),
      cursorCondition,
    ))
    .orderBy(desc(decisionCases.observedAt), desc(decisionCases.id))
    .limit(parsed.limit + 1);

  const pageRows = rows.slice(0, parsed.limit);
  const ids = pageRows.map(({ decisionCase }) => decisionCase.id);
  if (ids.length === 0) return { items: [], nextCursor: null };

  const [aiRows, baRows, executionRows] = await Promise.all([
    db.select().from(aiDecisions).where(inArray(aiDecisions.decisionCaseId, ids)),
    db.select().from(baDecisions)
      .where(inArray(baDecisions.decisionCaseId, ids))
      .orderBy(desc(baDecisions.createdAt), desc(baDecisions.id)),
    db.select().from(decisionExecutions)
      .where(inArray(decisionExecutions.decisionCaseId, ids))
      .orderBy(desc(decisionExecutions.createdAt), desc(decisionExecutions.id)),
  ]);
  const aiByCase = new Map(aiRows.map((row) => [row.decisionCaseId, row]));
  const baByCase = new Map<string, BaDecisionRow>();
  for (const row of baRows) if (!baByCase.has(row.decisionCaseId)) baByCase.set(row.decisionCaseId, row);
  const executionByCase = new Map<string, DecisionExecutionRow>();
  for (const row of executionRows) if (!executionByCase.has(row.decisionCaseId)) executionByCase.set(row.decisionCaseId, row);
  const last = pageRows.at(-1)?.decisionCase;
  return {
    items: pageRows.map(({ decisionCase, shop }) => makeReview(
      decisionCase,
      shop,
      aiByCase.get(decisionCase.id),
      baByCase.get(decisionCase.id),
      executionByCase.get(decisionCase.id),
    )),
    nextCursor: rows.length > parsed.limit && last ? encodeCursor(last) : null,
  };
}

export async function captureBaDecision(
  db: Database,
  input: CaptureBaDecisionInput,
): Promise<CapturedBaDecision> {
  const parsed = CaptureBaDecisionInputSchema.parse(input);
  const actor = requireBaActor();
  const ba = normalizeBaInput(parsed.baDecision);
  return db.transaction(async (transaction) => {
    const [decisionCase] = await transaction.insert(decisionCases)
      .values(parsed.decisionCase).returning();
    if (!decisionCase) throw new Error("Failed to create decision case");

    const [baDecision] = await transaction.insert(baDecisions).values({
      decisionCaseId: decisionCase.id,
      decision: parsed.baDecision.decision,
      reasonCode: ba.reasonCode,
      confidence: parsed.baDecision.confidence === undefined
        ? null
        : parsed.baDecision.confidence.toString(),
      reasonCodes: ba.reasonCodes,
      note: ba.note ?? null,
      notes: ba.note ?? null,
      actor,
    }).returning();
    if (!baDecision) throw new Error("Failed to create BA decision");
    return { decisionCase, baDecision };
  });
}
