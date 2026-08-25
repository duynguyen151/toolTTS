import {
  AiDecisionInputSchema,
  AiDecisionContextSchema,
  assertFrozenDecisionContext,
  validateFrozenDecisionContext,
  CaptureBaDecisionInputSchema,
  CreateDecisionCaseInputSchema,
  DecisionCoverageSnapshotSchema,
  DecisionFinanceSnapshotSchema,
  DecisionMetricsSnapshotSchema,
  DecisionRiskSnapshotSchema,
  ResolvedRiskPolicySnapshotSchema,
  RecordBaDecisionForCaseInputSchema,
  RecordDryRunExecutionInputSchema,
  type AiDecisionInput,
  type AiDecisionContext,
  type BaDecision,
  type BaDecisionReasonCode,
  type BaPlannedMethod,
  type CaptureBaDecisionInput,
  type CreateDecisionCaseInput,
  type DecisionDataCoverage,
  type DecisionDataOrigin,
  type DecisionCoverageSnapshot,
  type DecisionFinanceSnapshot,
  type DecisionMetricsSnapshot,
  type DecisionRiskSnapshot,
  type DecisionRuleResult,
  type ResolvedRiskPolicySnapshot,
  type DecisionRuleTrigger,
  type RecordBaDecisionForCaseInput,
  type RecordDryRunExecutionInput,
  type FrozenContextValidationInput,
} from "@shop-health/domain";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
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

export interface DecisionBaRevision {
  id: string;
  decision: BaDecision;
  reasonCode: BaDecisionReasonCode;
  confidence: number | null;
  reasonCodes: BaDecisionReasonCode[];
  plannedMethods: BaPlannedMethod[] | null;
  note: string | null;
  notes: string | null;
  actor: string;
  decidedAt: Date;
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
  decisionContextSnapshot: AiDecisionContext | null;
  resolvedPolicySnapshot: ResolvedRiskPolicySnapshot | null;
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
    plannedMethods: BaPlannedMethod[] | null;
    note: string | null;
    notes: string | null;
    actor: string;
    decidedAt: Date;
  } | null;
  baHistory: DecisionBaRevision[];
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
  decisionContextSnapshot: AiDecisionContext | null;
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

function contextCanonicalFacts(
  context: AiDecisionContext,
  owner?: { readonly shopId: string; readonly profileId?: string; readonly profileNo?: string },
): FrozenContextValidationInput {
  const metrics = context.metrics.decision;
  const finance = context.metrics.finance;
  const decimalString = (value: string | number | null): string | null => value === null ? null : typeof value === "number" ? String(value) : value;
  return {
    context,
    metrics: {
      ...metrics,
      onHoldValue: decimalString(metrics.operationalExposure),
    },
    finance: {
      ...finance,
      onHoldBalance: null,
      officialOnHoldAmount: decimalString(finance.officialFinanceOnHold),
    },
    coverage: {
      coverageState: context.dataQuality.coverage,
      persistedMetricsWindow: metrics.window,
      source: context.dataQuality.source,
      provenSourceWindow: context.dataQuality.provenSourceWindow,
      completeWithinSourceWindow: context.dataQuality.completeWithinSourceWindow,
      lifetimeHistoryComplete: context.dataQuality.lifetimeHistoryComplete,
      ordersSourceComplete: context.dataQuality.ordersSourceComplete,
      financeRequiredSourceComplete: context.dataQuality.financeRequiredSourceComplete,
      sourceReconciled: context.dataQuality.sourceReconciled,
      latestSuccessfulSyncAt: context.dataQuality.latestSuccessfulSyncAt,
      financeCapturedAt: context.dataQuality.financeCapturedAt,
      freshness: context.dataQuality.freshness,
    },
    risk: {
      ...context.risk,
      onHoldValue: decimalString(context.risk.operationalExposure),
    },
    ruleDecision: context.rule.result,
    ruleTriggers: context.rule.triggers.map((trigger) => trigger === "OPERATIONAL_EXPOSURE" ? "ONHOLD_VALUE" : "DELIVERY_RATE"),
    ...(owner === undefined ? {} : { owner }),
  };
}

async function loadContextOwner(db: Database, shopId: string): Promise<{ readonly profileId: string; readonly profileNo: string } | null> {
  const ownerQuery = db.select({ profileId: shops.profileId, profileNo: shops.profileNo })
    .from(shops)
    .where(eq(shops.id, shopId));
  const limit = (ownerQuery as unknown as { readonly limit?: (count: number) => Promise<Array<{ profileId: string; profileNo: string }>> }).limit;
  if (typeof limit !== "function") return null;
  const [owner] = await limit.call(ownerQuery, 1);
  return owner ?? null;
}

function parseDecisionContextSnapshot(
  value: unknown | null | undefined,
  canonical?: Omit<FrozenContextValidationInput, "context">,
): AiDecisionContext | null {
  if (value == null) return null;
  const parsed = AiDecisionContextSchema.safeParse(value);
  if (!parsed.success) return null;
  const facts = canonical === undefined
    ? contextCanonicalFacts(parsed.data, { shopId: parsed.data.shop.shopId, profileId: parsed.data.profile.profileId, profileNo: parsed.data.profile.profileNo })
    : { ...canonical, context: parsed.data };
  const validation = validateFrozenDecisionContext(facts);
  return validation.valid ? validation.context : null;
}

function parseDecisionContextSnapshotForWrite(
  value: unknown | null | undefined,
  canonical?: Omit<FrozenContextValidationInput, "context">,
): AiDecisionContext | null {
  if (value == null) return null;
  const parsed = AiDecisionContextSchema.parse(value);
  const facts = canonical === undefined
    ? contextCanonicalFacts(parsed, { shopId: parsed.shop.shopId, profileId: parsed.profile.profileId, profileNo: parsed.profile.profileNo })
    : { ...canonical, context: parsed };
  return assertFrozenDecisionContext(facts);
}

export async function createDecisionCase(
  db: Database,
  input: CreateDecisionCaseInput,
): Promise<DecisionCaseRow> {
  const parsed = CreateDecisionCaseInputSchema.parse(input);
  const owner = parsed.decisionContextSnapshot === null || parsed.decisionContextSnapshot === undefined
    ? null
    : await loadContextOwner(db, parsed.shopId);
  if (parsed.decisionContextSnapshot !== null && parsed.decisionContextSnapshot !== undefined && owner === null) {
    throw new Error("Decision context owner shop was not found");
  }
  const decisionContextSnapshot = parseDecisionContextSnapshotForWrite(
    parsed.decisionContextSnapshot,
    {
      metrics: parsed.metricsSnapshot,
      finance: parsed.financeSnapshot,
      coverage: parsed.coverageSnapshot,
      risk: parsed.riskSnapshot,
      ruleDecision: parsed.ruleDecision,
      ruleTriggers: parsed.ruleTriggers,
      owner: {
        shopId: parsed.shopId,
        ...(owner === null ? {} : { profileId: owner.profileId, profileNo: owner.profileNo }),
      },
    },
  );
  const [created] = await db.insert(decisionCases).values({
    ...parsed,
    decisionContextSnapshot,
  })
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
    shopId: decisionCases.shopId,
    metricsSnapshot: decisionCases.metricsSnapshot,
    financeSnapshot: decisionCases.financeSnapshot,
    coverageSnapshot: decisionCases.coverageSnapshot,
    riskSnapshot: decisionCases.riskSnapshot,
    ruleDecision: decisionCases.ruleDecision,
    ruleTriggers: decisionCases.ruleTriggers,
    dataCoverage: decisionCases.dataCoverage,
    decisionContextSnapshot: decisionCases.decisionContextSnapshot,
  }).from(decisionCases).where(eq(decisionCases.id, parsedCaseId)).limit(1);
  if (!decisionCase) return null;
  const owner = typeof decisionCase.shopId === "string"
    ? await loadContextOwner(db, decisionCase.shopId)
    : null;
  const coverageSnapshot = decisionCase.coverageSnapshot ?? {
    coverageState: decisionCase.dataCoverage,
    persistedMetricsWindow: decisionCase.metricsSnapshot.window,
    provenSourceWindow: null,
    completeWithinSourceWindow: null,
    lifetimeHistoryComplete: null,
  };
  const decisionContextSnapshot = parseDecisionContextSnapshot(
    decisionCase.decisionContextSnapshot,
    {
      metrics: DecisionMetricsSnapshotSchema.parse(decisionCase.metricsSnapshot),
      finance: DecisionFinanceSnapshotSchema.parse({
        ...decisionCase.financeSnapshot,
        officialOnHoldAmount: decisionCase.financeSnapshot.officialOnHoldAmount ?? null,
        waitingForCompletedRefundReturnAmount: decisionCase.financeSnapshot.waitingForCompletedRefundReturnAmount ?? null,
      }),
      coverage: DecisionCoverageSnapshotSchema.parse(coverageSnapshot),
      risk: DecisionRiskSnapshotSchema.parse(decisionCase.riskSnapshot),
      ruleDecision: decisionCase.ruleDecision,
      ruleTriggers: decisionCase.ruleTriggers,
      owner: {
        shopId: decisionCase.shopId,
        ...(owner === null ? {} : { profileId: owner.profileId, profileNo: owner.profileNo }),
      },
    },
  );
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
    decisionContextSnapshot,
  };
}

export async function getLatestDecisionContext(
  db: Database,
  shopId: string,
): Promise<AiDecisionContext | null> {
  const rows = await db.select({ decisionCase: decisionCases })
    .from(decisionCases)
    .where(and(eq(decisionCases.shopId, shopId), isNotNull(decisionCases.decisionContextSnapshot)))
    .orderBy(desc(decisionCases.observedAt), desc(decisionCases.id))
    .limit(100);
  const owner = await loadContextOwner(db, shopId);
  for (const row of rows) {
    const decisionCase = row.decisionCase;
    const coverageSnapshot = decisionCase.coverageSnapshot ?? {
      coverageState: decisionCase.dataCoverage,
      persistedMetricsWindow: decisionCase.metricsSnapshot.window,
      provenSourceWindow: null,
      completeWithinSourceWindow: null,
      lifetimeHistoryComplete: null,
    };
    const context = parseDecisionContextSnapshot(
      decisionCase.decisionContextSnapshot,
      {
        metrics: DecisionMetricsSnapshotSchema.parse(decisionCase.metricsSnapshot),
        finance: DecisionFinanceSnapshotSchema.parse({
          ...decisionCase.financeSnapshot,
          officialOnHoldAmount: decisionCase.financeSnapshot.officialOnHoldAmount ?? null,
          waitingForCompletedRefundReturnAmount: decisionCase.financeSnapshot.waitingForCompletedRefundReturnAmount ?? null,
        }),
        coverage: DecisionCoverageSnapshotSchema.parse(coverageSnapshot),
        risk: DecisionRiskSnapshotSchema.parse(decisionCase.riskSnapshot),
        ruleDecision: decisionCase.ruleDecision,
        ruleTriggers: decisionCase.ruleTriggers,
        owner: {
          shopId: decisionCase.shopId,
          ...(owner === null ? {} : { profileId: owner.profileId, profileNo: owner.profileNo }),
        },
      },
    );
    if (context !== null) return context;
  }
  return null;
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
    plannedMethods: parsed.baDecision.plannedMethods ?? null,
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
    !isDeepStrictEqual(existing.reasonCodes, parsed.baDecision.reasonCodes ?? [parsed.baDecision.reasonCode]) ||
    !isDeepStrictEqual(existing.plannedMethods, parsed.baDecision.plannedMethods ?? null) ||
    existing.note !== (parsed.baDecision.notes ?? parsed.baDecision.note ?? null)
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

function formatRatePercent(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Delivery rate threshold must be finite");

  // Normalize binary floating-point noise before rendering a human threshold.
  const canonicalValue = Number(value.toPrecision(12));
  const [rawMantissa = "", rawExponent] = String(canonicalValue).toLowerCase().split("e");
  const sign = rawMantissa.startsWith("-") ? "-" : "";
  const mantissa = sign === "" ? rawMantissa : rawMantissa.slice(1);
  const [whole = "", fraction = ""] = mantissa.split(".");
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + (rawExponent === undefined ? 0 : Number(rawExponent)) + 2;
  const formatted = decimalIndex <= 0
    ? `0.${"0".repeat(-decimalIndex)}${digits}`
    : decimalIndex >= digits.length
      ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
      : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  const [integer = "", fractional = ""] = formatted.split(".");
  const normalizedInteger = integer.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fractional.replace(/0+$/, "");
  return `${sign}${normalizedInteger}${normalizedFraction === "" ? "" : `.${normalizedFraction}`}`;
}

function makeReview(
  decisionCase: DecisionCaseRow,
  shop: ShopRow,
  aiDecision: AiDecisionRow | undefined,
  baDecision: BaDecisionRow | undefined,
  execution: DecisionExecutionRow | undefined,
  baHistory: readonly BaDecisionRow[] = baDecision === undefined ? [] : [baDecision],
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
  const decisionContextSnapshot = parseDecisionContextSnapshot(
    decisionCase.decisionContextSnapshot,
    {
      metrics: DecisionMetricsSnapshotSchema.parse(metrics),
      finance: DecisionFinanceSnapshotSchema.parse({
        ...decisionCase.financeSnapshot,
        officialOnHoldAmount: decisionCase.financeSnapshot.officialOnHoldAmount ?? null,
        waitingForCompletedRefundReturnAmount: decisionCase.financeSnapshot.waitingForCompletedRefundReturnAmount ?? null,
      }),
      coverage: DecisionCoverageSnapshotSchema.parse(coverageSnapshot),
      risk: DecisionRiskSnapshotSchema.parse(risk),
      ruleDecision: decisionCase.ruleDecision,
      ruleTriggers: decisionCase.ruleTriggers,
      owner: { shopId: shop.id, profileId: shop.profileId, profileNo: shop.profileNo },
    },
  );
  const invalidPersistedContext = decisionCase.decisionContextSnapshot !== null && decisionContextSnapshot === null;
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
    decisionContextSnapshot,
    resolvedPolicySnapshot: decisionCase.resolvedPolicySnapshot == null
      ? null
      : ResolvedRiskPolicySnapshotSchema.parse(decisionCase.resolvedPolicySnapshot),
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
      expression: `VALUE >= ${stopOnHoldValueAt} ${metrics.currency} OR DELIVERY_RATE < ${formatRatePercent(stopDeliveryRateBelow)}%`,
      policyVersion: risk.policyVersion,
      thresholds: { stopOnHoldValueAt, stopDeliveryRateBelow, minimumOrdersForRateRule },
    },
    ai: !aiDecision
      ? null
      : invalidPersistedContext && aiDecision.status === "AVAILABLE"
        ? {
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
            failureCode: "INVALID_RESPONSE",
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
          }
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
      plannedMethods: baDecision.plannedMethods,
      note: baDecision.note,
      notes: baDecision.notes,
      actor: baDecision.actor,
      decidedAt: baDecision.createdAt,
    },
    baHistory: baHistory.map((revision) => ({
      id: revision.id,
      decision: revision.decision,
      reasonCode: revision.reasonCode,
      confidence: revision.confidence === null ? null : Number(revision.confidence),
      reasonCodes: revision.reasonCodes,
      plannedMethods: revision.plannedMethods,
      note: revision.note,
      notes: revision.notes,
      actor: revision.actor,
      decidedAt: revision.createdAt,
    })),
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

async function resolveQueryRows<T>(query: unknown): Promise<T[]> {
  const candidate = query as {
    readonly then?: (onFulfilled: (value: T[]) => unknown) => Promise<unknown>;
    readonly limit?: (count: number) => Promise<T[]>;
  };
  if (typeof candidate.then === "function") return candidate.then((rows) => rows) as Promise<T[]>;
  if (typeof candidate.limit === "function") return candidate.limit(100);
  return [];
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

  const [[aiDecision], baRows, [execution]] = await Promise.all([
    db.select().from(aiDecisions).where(eq(aiDecisions.decisionCaseId, parsedCaseId)).limit(1),
    resolveQueryRows<BaDecisionRow>(db.select().from(baDecisions)
      .where(eq(baDecisions.decisionCaseId, parsedCaseId))
      .orderBy(desc(baDecisions.createdAt), desc(baDecisions.id))),
    db.select().from(decisionExecutions)
      .where(eq(decisionExecutions.decisionCaseId, parsedCaseId))
      .orderBy(desc(decisionExecutions.createdAt), desc(decisionExecutions.id)).limit(1),
  ]);
  return makeReview(base.decisionCase, base.shop, aiDecision, baRows[0], execution, baRows);
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
  const baByCase = new Map<string, BaDecisionRow[]>();
  for (const row of baRows) baByCase.set(row.decisionCaseId, [...(baByCase.get(row.decisionCaseId) ?? []), row]);
  const executionByCase = new Map<string, DecisionExecutionRow>();
  for (const row of executionRows) if (!executionByCase.has(row.decisionCaseId)) executionByCase.set(row.decisionCaseId, row);
  const last = pageRows.at(-1)?.decisionCase;
  return {
    items: pageRows.map(({ decisionCase, shop }) => makeReview(
      decisionCase,
      shop,
      aiByCase.get(decisionCase.id),
      baByCase.get(decisionCase.id)?.[0],
      executionByCase.get(decisionCase.id),
      baByCase.get(decisionCase.id),
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
    const [owner] = await transaction.select({ profileId: shops.profileId, profileNo: shops.profileNo })
      .from(shops)
      .where(eq(shops.id, parsed.decisionCase.shopId))
      .limit(1);
    if (!owner) throw new Error("Decision context owner shop was not found");
    const [decisionCase] = await transaction.insert(decisionCases)
      .values({
        ...parsed.decisionCase,
        decisionContextSnapshot: parseDecisionContextSnapshotForWrite(
          parsed.decisionCase.decisionContextSnapshot,
          {
            metrics: parsed.decisionCase.metricsSnapshot,
            finance: parsed.decisionCase.financeSnapshot,
            coverage: parsed.decisionCase.coverageSnapshot,
            risk: parsed.decisionCase.riskSnapshot,
            ruleDecision: parsed.decisionCase.ruleDecision,
            ruleTriggers: parsed.decisionCase.ruleTriggers,
            owner: {
              shopId: parsed.decisionCase.shopId,
              profileId: owner.profileId,
              profileNo: owner.profileNo,
            },
          },
        ),
      }).returning();
    if (!decisionCase) throw new Error("Failed to create decision case");

    const [baDecision] = await transaction.insert(baDecisions).values({
      decisionCaseId: decisionCase.id,
      decision: parsed.baDecision.decision,
      reasonCode: ba.reasonCode,
      confidence: parsed.baDecision.confidence === undefined
        ? null
        : parsed.baDecision.confidence.toString(),
      reasonCodes: ba.reasonCodes,
      plannedMethods: parsed.baDecision.plannedMethods ?? null,
      note: ba.note ?? null,
      notes: ba.note ?? null,
      actor,
    }).returning();
    if (!baDecision) throw new Error("Failed to create BA decision");
    return { decisionCase, baDecision };
  });
}
