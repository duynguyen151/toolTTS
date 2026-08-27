import {
  buildDecisionFinanceSnapshot,
  createDecisionCase,
  findEnabledShopProviderBinding,
  findLatestSuccessfulSyncRun,
  findShopByProfileNo,
  listSyncRuns,
  getDecisionAiInput,
  getLatestDecisionContext,
  getDecisionReview,
  getDecisionReviewByRequestId,
  getFinanceSummary,
  getFullPersistedRiskOrderFacts,
  getRiskControlState,
  getEffectiveRiskPolicy,
  listDecisionHistory,
  recordAiDecision,
  recordBaDecisionForCase,
  recordDryRunExecution,
  type DatabaseContext,
} from "@shop-health/db";
import type { BaselineAiClient, BaselineAiInputRecord, BaselineAiResult } from "@shop-health/decision-ai";
import {
  resolveFinanceHealth,
  SELLER_CENTER_OFFICIAL_ON_HOLD_PROOF,
  type DecisionCoverageSnapshot,
  type DecisionFinanceSnapshot,
  type FinanceHealthSnapshot,
  type RiskOrderFact,
  type SourceCoverageProof,
} from "@shop-health/domain";

import type { PersistedDecisionReview } from "./presentation.js";
import type { DecisionWorkflowStore, ReviewStartSource } from "./workflow.js";
import { createDecisionWorkflow } from "./workflow.js";

export interface PersistedDecisionWorkflowOptions {
  readonly context: DatabaseContext;
  readonly aiClient: BaselineAiClient;
  readonly now?: () => Date;
  readonly randomUuid?: () => string;
  readonly freshnessWindowMs?: number;
}

export interface DecisionFreshnessEvidence {
  readonly now: Date;
  readonly freshnessWindowMs: number;
  readonly ordersSyncAt: Date | null;
  readonly financeSyncAt: Date | null;
  readonly financeCapturedAt: Date | null;
}

export interface DecisionCompletenessEvidence {
  readonly sourceCoverage: SourceCoverageProof | null | undefined;
  readonly ordersSourceComplete: boolean | null | undefined;
  readonly financeSourceComplete: boolean | null | undefined;
  readonly financeSnapshotCapturedAt: Date | null;
  readonly sourceReconciled: boolean | null | undefined;
}

export interface DecisionFinanceHealthEvidence {
  readonly evaluatedAt: Date;
  readonly freshnessWindowMs: number;
  readonly latestRefreshRun: { readonly status: "RUNNING" | "SUCCEEDED" | "FAILED" | "ABORTED" | "PAUSED" } | null;
  readonly selectedFinanceRun: {
    readonly status: "RUNNING" | "SUCCEEDED" | "FAILED" | "ABORTED" | "PAUSED";
    readonly sourceComplete: boolean | null | undefined;
    readonly sourceCapturedAt: Date | null | undefined;
    readonly sourceReconciled?: boolean | null | undefined;
  } | null;
  readonly providerBinding?: {
    readonly provenance: { readonly source: "SELLER_CENTER" | "COTIK"; readonly capabilities: readonly ("ORDERS" | "SUPPLEMENTARY_FINANCE" | "OFFICIAL_ON_HOLD")[] };
    readonly providerUpdatedAt: Date | null;
  } | null;
  readonly financeSummary: { readonly proofStatus: "PROVEN" | "PROOF_UNAVAILABLE" };
  readonly reconciled: boolean | null | undefined;
}

export function resolveDecisionFinanceHealth(
  evidence: DecisionFinanceHealthEvidence,
): FinanceHealthSnapshot {
  return resolveFinanceHealth({
    capabilityProof: SELLER_CENTER_OFFICIAL_ON_HOLD_PROOF,
    providerUpdatedAt: evidence.providerBinding?.provenance.capabilities.includes("OFFICIAL_ON_HOLD")
      ? evidence.providerBinding.providerUpdatedAt
      : null,
    collectedAt: evidence.selectedFinanceRun?.sourceCapturedAt ?? null,
    evaluatedAt: evidence.evaluatedAt,
    freshnessWindowMs: evidence.freshnessWindowMs,
    proofStatus: evidence.financeSummary.proofStatus,
    sourceComplete: evidence.selectedFinanceRun?.sourceComplete ?? null,
    reconciled: evidence.selectedFinanceRun?.sourceReconciled ?? evidence.reconciled ?? null,
    refreshState: evidence.latestRefreshRun?.status ?? "NOT_REQUESTED",
  });
}

export function resolveFinanceCaptureAt(
  run: { readonly sourceComplete: boolean | null | undefined; readonly sourceCapturedAt: Date | null | undefined } | null,
  _deduplicatedSnapshotCapturedAt: Date | null,
): Date | null {
  return run?.sourceComplete === true && run.sourceCapturedAt != null
    ? run.sourceCapturedAt
    : null;
}

export function resolveVerifiedFinanceCaptureAt(
  latestRun: { readonly sourceComplete: boolean | null | undefined; readonly sourceCapturedAt: Date | null | undefined } | null,
  latestProvenRun: { readonly sourceComplete: boolean | null | undefined; readonly sourceCapturedAt: Date | null | undefined } | null,
): Date | null {
  return latestProvenRun?.sourceComplete === true && latestProvenRun.sourceCapturedAt != null
    ? latestProvenRun.sourceCapturedAt
    : resolveFinanceCaptureAt(latestRun, null);
}

export function isCompleteDecisionCoverage(
  evidence: DecisionCompletenessEvidence,
): boolean {
  return evidence.sourceCoverage?.source === "SELLER_CENTER" &&
    evidence.sourceCoverage.window === "ROLLING_12_MONTHS" &&
    evidence.sourceCoverage.completeWithinSourceWindow === true &&
    evidence.sourceCoverage.lifetimeHistoryComplete === false &&
    evidence.ordersSourceComplete === true &&
    evidence.financeSourceComplete === true &&
    evidence.financeSnapshotCapturedAt !== null &&
    evidence.sourceReconciled === true;
}

export function assessDecisionFreshness(
  evidence: DecisionFreshnessEvidence,
): "FRESH" | "STALE" | "UNKNOWN" {
  const required = [evidence.ordersSyncAt, evidence.financeSyncAt, evidence.financeCapturedAt];
  if (required.some((value) => value === null)) return "UNKNOWN";
  return required.some((value) => evidence.now.getTime() - value!.getTime() > evidence.freshnessWindowMs)
    ? "STALE"
    : "FRESH";
}

export function resolveDecisionPeriod(
  facts: readonly RiskOrderFact[],
  periodEnd: Date,
): { readonly periodStart: Date; readonly periodEnd: Date } {
  const firstObserved = facts
    .map((fact) => fact.firstObservedAt)
    .filter((value): value is Date => value !== undefined && value !== null)
    .sort((left, right) => left.getTime() - right.getTime())[0];
  return {
    periodStart: firstObserved ?? periodEnd,
    periodEnd,
  };
}

function toRiskFacts(rows: readonly RiskOrderFact[]): RiskOrderFact[] {
  return rows.map((row) => ({
    canonicalStatus: row.canonicalStatus,
    currency: row.currency,
    orderCount: row.orderCount,
    totalValue: row.totalValue,
    ...(row.firstObservedAt === undefined ? {} : { firstObservedAt: row.firstObservedAt }),
    ...(row.lastObservedAt === undefined ? {} : { lastObservedAt: row.lastObservedAt }),
  }));
}

function aiInputForPersistence(
  requestId: string,
  decisionCaseId: string,
  result: BaselineAiResult,
) {
  const common = {
    requestId,
    decisionCaseId,
    provider: result.provider,
    requestedModel: result.requestedModel,
    reportedModel: result.reportedModel,
    actualModelUsed: result.actualModelUsed,
    authMode: result.authMode,
    outputSchemaVersion: result.outputSchemaVersion,
    promptVersion: result.promptVersion,
    policyVersion: result.rulePolicyVersion,
    aiPolicyVersion: result.aiPolicyVersion,
  };
  return result.status === "AVAILABLE"
    ? {
        ...common,
        status: "AVAILABLE" as const,
        model: result.actualModelUsed,
        reportedModel: result.reportedModel,
        actualModelUsed: result.actualModelUsed,
        recommendation: result.recommendation,
        riskLevel: result.riskLevel,
        confidence: result.confidence,
        ruleOverride: result.ruleOverride,
        reasonCodes: result.reasonCodes,
        supportingFactors: result.supportingFactors,
        riskFactors: result.riskFactors,
        whatWouldChangeDecision: result.whatWouldChangeDecision,
        reason: result.reason,
        humanReviewRequired: result.humanReviewRequired,
        failureCode: null,
      }
    : {
        ...common,
        status: "UNAVAILABLE" as const,
        model: null,
        reportedModel: null,
        actualModelUsed: null,
        recommendation: null,
        riskLevel: null,
        confidence: null,
        ruleOverride: null,
        reasonCodes: null,
        supportingFactors: null,
        riskFactors: null,
        whatWouldChangeDecision: null,
        reason: null,
        humanReviewRequired: true as const,
        failureCode: result.errorCode,
      };
}

export function createPersistedDecisionWorkflow(
  options: PersistedDecisionWorkflowOptions,
) {
  const freshnessWindowMs = options.freshnessWindowMs ?? 86_400_000;
  const db = options.context.db;
  const store: DecisionWorkflowStore = {
    async getDecisionReviewByRequestId(requestId): Promise<PersistedDecisionReview | null> {
      return (await getDecisionReviewByRequestId(db, requestId)) as PersistedDecisionReview | null;
    },
    async getDecisionAiInput(caseId) {
      const input = await getDecisionAiInput(db, caseId);
      if (input === null) throw new Error(`Decision case not found: ${caseId}`);
      return input satisfies BaselineAiInputRecord;
    },
    async loadReviewStartSource(profileNo, effectiveAt): Promise<ReviewStartSource> {
      const shop = await findShopByProfileNo(db, profileNo);
      if (shop === null) throw new Error(`Shop not found: ${profileNo}`);
      const [facts, latestOrdersRun, latestFinanceRun, latestProvenFinanceRun, latestFinanceRefreshRun, sellerCenterBinding, riskState, previousDecisionContext, resolvedPolicySnapshot] = await Promise.all([
        getFullPersistedRiskOrderFacts(db, shop.id),
        findLatestSuccessfulSyncRun(db, shop.id, "ORDERS"),
        findLatestSuccessfulSyncRun(db, shop.id, "FINANCE"),
        findLatestSuccessfulSyncRun(db, shop.id, "FINANCE", true, true),
        listSyncRuns(db, shop.id, 1, "FINANCE").then(([run]) => run ?? null),
        findEnabledShopProviderBinding(db, shop.id, "SELLER_CENTER"),
        getRiskControlState(db, shop.id),
        getLatestDecisionContext(db, shop.id),
        getEffectiveRiskPolicy(db, { shopId: shop.id, effectiveAt }),
      ]);
      const financeCaptureAt = resolveVerifiedFinanceCaptureAt(latestFinanceRun, latestProvenFinanceRun);
      const financeSummary = await getFinanceSummary(db, shop.id, financeCaptureAt);
      const snapshot = financeSummary.proofStatus === "PROVEN" ? financeSummary.latestSnapshot : null;
      const provenFinanceCaptureAt = financeSummary.proofStatus === "PROVEN" ? financeCaptureAt : null;
      const financeSnapshot = buildDecisionFinanceSnapshot({
        capturedAt: provenFinanceCaptureAt,
        currency: snapshot?.currency ?? shop.currency,
        availableBalance: snapshot?.availableBalance ?? null,
        frozenBalance: snapshot?.frozenBalance ?? null,
        totalBalance: snapshot?.totalBalance ?? null,
        toSettleBalance: snapshot?.toSettleBalance ?? null,
        onHoldBalance: snapshot?.onHoldBalance ?? null,
        officialOnHoldAmount: snapshot?.officialOnHoldAmount ?? null,
        settlements: [],
        reasonSummary: {
          statementCount: financeSummary.statementCount,
          onHoldCount: financeSummary.onHoldCount,
          waitingForPackageDeliveryAmount: financeSummary.waitingForPackageDeliveryAmount,
          deliveredAwaitingSettlementAmount: financeSummary.deliveredAwaitingSettlementAmount,
          waitingForCompletedRefundReturnAmount: financeSummary.waitingForCompletedRefundReturnAmount,
          unknownOnHoldReasonCount: financeSummary.unknownOnHoldReasonCount,
          missingOnHoldExpectedAmountCount: financeSummary.missingOnHoldExpectedAmountCount,
        },
      });
      const typedFinanceSnapshot: DecisionFinanceSnapshot = {
        ...financeSnapshot,
        settlementCount: financeSummary.statementCount,
      };
      const coverageProof = latestOrdersRun?.sourceCoverage;
      const latestSuccessfulSyncAt = [latestOrdersRun?.finishedAt, latestFinanceRun?.finishedAt]
        .filter((value): value is Date => value !== null && value !== undefined)
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
      const ordersSourceComplete = latestOrdersRun === null
        ? null
        : latestOrdersRun.sourceComplete === true && coverageProof?.completeWithinSourceWindow === true;
      const financeRequiredSourceComplete = latestFinanceRun === null
        ? null
        : latestFinanceRun.sourceComplete === true &&
          provenFinanceCaptureAt !== null && snapshot !== null &&
          financeSummary.proofStatus === "PROVEN";
      const complete = isCompleteDecisionCoverage({
        sourceCoverage: coverageProof,
        ordersSourceComplete,
        financeSourceComplete: financeRequiredSourceComplete,
        financeSnapshotCapturedAt: provenFinanceCaptureAt,
        sourceReconciled: typedFinanceSnapshot.reasonTotalsReconcileToOfficialOnHold,
      });
      const freshness = assessDecisionFreshness({
        now: effectiveAt,
        freshnessWindowMs,
        ordersSyncAt: latestOrdersRun?.finishedAt ?? null,
        financeSyncAt: latestFinanceRun?.finishedAt ?? null,
        financeCapturedAt: provenFinanceCaptureAt,
      });
      const dataCoverage = complete && freshness === "FRESH" ? "COMPLETE" as const : "PARTIAL" as const;
      const coverageSnapshot: DecisionCoverageSnapshot = {
        coverageState: dataCoverage,
        persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
        source: coverageProof?.source ?? null,
        provenSourceWindow: coverageProof?.window ?? null,
        completeWithinSourceWindow: coverageProof?.completeWithinSourceWindow ?? null,
        lifetimeHistoryComplete: coverageProof?.lifetimeHistoryComplete ?? null,
        ordersSourceComplete,
        financeRequiredSourceComplete,
        sourceReconciled: typedFinanceSnapshot.reasonTotalsReconcileToOfficialOnHold,
        latestSuccessfulSyncAt: latestSuccessfulSyncAt?.toISOString() ?? null,
        financeCapturedAt: provenFinanceCaptureAt?.toISOString() ?? null,
        freshness,
        financeHealth: resolveDecisionFinanceHealth({
          evaluatedAt: effectiveAt,
          freshnessWindowMs,
          latestRefreshRun: latestFinanceRefreshRun,
          selectedFinanceRun: latestProvenFinanceRun ?? latestFinanceRun,
          providerBinding: sellerCenterBinding,
          financeSummary,
          reconciled: typedFinanceSnapshot.reasonTotalsReconcileToOfficialOnHold,
        }),
      };
      const period = resolveDecisionPeriod(facts, effectiveAt);
      return {
        shop: {
          id: shop.id,
          profileNo: shop.profileNo,
          displayName: shop.displayName ?? shop.profileNo,
          currency: shop.currency,
          dataOrigin: shop.dataOrigin,
          dataCoverage,
          lastSyncAt: latestSuccessfulSyncAt,
        },
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        facts: toRiskFacts(facts),
        financeSnapshot: typedFinanceSnapshot,
        officialOnHoldAmount: typedFinanceSnapshot.officialOnHoldAmount,
        officialOnHoldCapturedAt: typedFinanceSnapshot.capturedAt === null
          ? null
          : new Date(typedFinanceSnapshot.capturedAt),
        coverageSnapshot,
        sourceSyncRunId: latestOrdersRun?.id ?? null,
        holidayModeCurrentlyEnabled: riskState?.observedHolidayModeEnabled ?? null,
        consecutiveSafeCycles: riskState?.consecutiveSafeCycles ?? 0,
        decisionIdentity: {
          profileId: shop.profileId,
          tiktokShopId: shop.tiktokShopId,
          region: "US",
          locale: "en-US",
        },
        previousDecisionContext,
        resolvedPolicySnapshot,
      };
    },
    async createDecisionCase(input) {
      const row = await createDecisionCase(db, {
        requestId: input.requestId,
        caseOrigin: input.caseOrigin,
        ...input.decisionCase,
      });
      return { caseId: row.id };
    },
    async recordAiDecision(input) {
      await recordAiDecision(db, aiInputForPersistence(input.requestId, input.decisionCaseId, input.result));
    },
    async recordBaDecision(input) {
      await recordBaDecisionForCase(db, {
        requestId: input.requestId,
        decisionCaseId: input.decisionCaseId,
        baDecision: {
          decision: input.decision,
          reasonCode: input.reasonCode,
          ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
          reasonCodes: [...input.reasonCodes],
          ...(input.plannedMethods === undefined ? {} : { plannedMethods: [...input.plannedMethods] }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
        },
      });
    },
    async recordDryRunExecution(input) {
      await recordDryRunExecution(db, {
        requestId: input.requestId,
        decisionCaseId: input.decisionCaseId,
        baDecisionId: input.baDecisionId,
        requestedAction: "HOLIDAY_MODE_ON",
        executionMode: "DRY_RUN",
      });
    },
    async getDecisionReview(caseId) {
      const review = await getDecisionReview(db, caseId);
      if (review === null) throw new Error(`Decision case not found: ${caseId}`);
      return review as PersistedDecisionReview;
    },
    async listDecisionHistory(input) {
      return listDecisionHistory(db, input);
    },
  };
  return createDecisionWorkflow({
    store,
    aiClient: options.aiClient,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.randomUuid === undefined ? {} : { randomUuid: options.randomUuid }),
  });
}
