import {
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
  type AiDecisionInput,
  type Database,
  type RiskOrderFactRow,
} from "@shop-health/db";
import {
  createBaselineAiClientFromConfig,
  readBaselineAiConfig,
  type BaselineAiClient,
  type BaselineAiInput,
  type BaselineAiResult,
} from "@shop-health/decision-ai";
import {
  createDecisionWorkflow,
  resolveDecisionFinanceHealth,
  type DecisionWorkflow,
  type DecisionWorkflowStore,
  type PersistedDecisionReview,
} from "@shop-health/decision-workflow";

import { withDatabase } from "./db-runtime.js";
import { CliError } from "./errors.js";
import type { CliRuntime } from "./runtime.js";

export function toAiPersistenceInput(
  requestId: string,
  decisionCaseId: string,
  result: BaselineAiResult,
): AiDecisionInput {
  const provenance = {
    requestId,
    decisionCaseId,
    provider: result.provider,
    requestedModel: result.requestedModel,
    authMode: result.authMode,
    outputSchemaVersion: result.outputSchemaVersion,
    promptVersion: result.promptVersion,
    policyVersion: result.rulePolicyVersion,
    aiPolicyVersion: result.aiPolicyVersion,
  };
  if (result.status === "AVAILABLE") {
    return {
      ...provenance,
      status: "AVAILABLE",
      model: result.actualModelUsed,
      reportedModel: result.reportedModel,
      actualModelUsed: result.actualModelUsed,
      recommendation: result.recommendation,
      riskLevel: result.riskLevel,
      confidence: result.confidence,
      ruleOverride: result.ruleOverride,
      reasonCodes: [...result.reasonCodes],
      supportingFactors: [...result.supportingFactors],
      riskFactors: [...result.riskFactors],
      whatWouldChangeDecision: [...result.whatWouldChangeDecision],
      reason: result.reason,
      humanReviewRequired: result.humanReviewRequired,
      failureCode: null,
    };
  }
  return {
    ...provenance,
    status: "UNAVAILABLE",
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
    humanReviewRequired: true,
    failureCode: result.errorCode,
  };
}

export function normalizeRiskFacts(facts: readonly RiskOrderFactRow[]): RiskOrderFactRow[] {
  return facts.map((fact) => ({
    ...fact,
    firstObservedAt: fact.firstObservedAt instanceof Date
      ? fact.firstObservedAt
      : new Date(fact.firstObservedAt),
    lastObservedAt: fact.lastObservedAt instanceof Date
      ? fact.lastObservedAt
      : new Date(fact.lastObservedAt),
  }));
}

export function resolveFullHistoryPeriod<T extends { readonly firstObservedAt: Date }>(
  facts: readonly T[],
  periodEnd: Date,
): { readonly periodStart: Date; readonly periodEnd: Date } {
  const earliest = facts.reduce<Date | null>(
    (current, fact) => current === null || fact.firstObservedAt < current
      ? fact.firstObservedAt
      : current,
    null,
  );
  return {
    periodStart: earliest === null
      ? periodEnd
      : earliest < periodEnd
        ? earliest
        : new Date(periodEnd.getTime() - 1),
    periodEnd,
  };
}

function latestDate(left: Date | null, right: Date | null): Date | null {
  if (left === null) return right;
  if (right === null) return left;
  return left > right ? left : right;
}

function notFound(kind: "shop" | "case", value: string): CliError {
  return new CliError({
    failureType: kind === "shop" ? "SHOP_NOT_FOUND" : "DECISION_CASE_NOT_FOUND",
    message: kind === "shop"
      ? `Shop profile ${value} is not configured`
      : `Decision case ${value} was not found`,
  });
}

export function createDbDecisionWorkflowStore(
  db: Database,
  now: () => Date = () => new Date(),
): DecisionWorkflowStore {
  return {
    async getDecisionReviewByRequestId(requestId) {
      const record = await getDecisionReviewByRequestId(db, requestId);
      return record as PersistedDecisionReview | null;
    },

    async getDecisionAiInput(caseId) {
      const input = await getDecisionAiInput(db, caseId);
      if (input === null) {
        throw new CliError({
          failureType: "DECISION_AI_INPUT_NOT_FOUND",
          message: `Persisted AI input for decision case ${caseId} was not found`,
        });
      }
      return input as BaselineAiInput;
    },

    async loadReviewStartSource(profileNo, effectiveAt) {
      const shop = await findShopByProfileNo(db, profileNo);
      if (shop === null) throw notFound("shop", profileNo);
      const [facts, latestSuccessfulSync, latestFinanceRun, latestProvenFinanceRun, latestFinanceRefreshRun, sellerCenterBinding, riskState, previousDecisionContext, resolvedPolicySnapshot] = await Promise.all([
        getFullPersistedRiskOrderFacts(db, shop.id),
        findLatestSuccessfulSyncRun(db, shop.id),
        findLatestSuccessfulSyncRun(db, shop.id, "FINANCE"),
        findLatestSuccessfulSyncRun(db, shop.id, "FINANCE", true, true),
        listSyncRuns(db, shop.id, 1, "FINANCE").then(([run]) => run ?? null),
        findEnabledShopProviderBinding(db, shop.id, "SELLER_CENTER"),
        getRiskControlState(db, shop.id),
        getLatestDecisionContext(db, shop.id),
        getEffectiveRiskPolicy(db, { shopId: shop.id, effectiveAt }),
      ]);
      const selectedFinanceRun = latestProvenFinanceRun ?? latestFinanceRun;
      const finance = await getFinanceSummary(db, shop.id, selectedFinanceRun?.sourceCapturedAt ?? null);
      const normalizedFacts = normalizeRiskFacts(facts);
      const period = resolveFullHistoryPeriod(normalizedFacts, effectiveAt);
      const snapshot = finance.proofStatus === "PROVEN" ? finance.latestSnapshot : null;
      const statementCount = finance.proofStatus === "PROVEN" ? finance.statementCount : 0;
      const onHoldCount = finance.proofStatus === "PROVEN" ? finance.onHoldCount : 0;
      return {
        shop: {
          id: shop.id,
          profileNo: shop.profileNo,
          displayName: shop.displayName ?? shop.profileNo,
          currency: shop.currency,
          dataOrigin: shop.dataOrigin,
          dataCoverage: "UNKNOWN",
          lastSyncAt: latestDate(shop.lastOrdersSyncedAt, shop.lastFinanceSyncedAt),
        },
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        facts: normalizedFacts,
        coverageSnapshot: {
          coverageState: "UNKNOWN",
          persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
          source: null,
          provenSourceWindow: null,
          completeWithinSourceWindow: null,
          lifetimeHistoryComplete: null,
          financeHealth: resolveDecisionFinanceHealth({
            evaluatedAt: effectiveAt,
            freshnessWindowMs: 86_400_000,
            latestRefreshRun: latestFinanceRefreshRun,
            selectedFinanceRun,
            providerBinding: sellerCenterBinding,
            financeSummary: finance,
            reconciled: finance.proofStatus === "PROVEN" &&
              finance.unknownOnHoldReasonCount === 0 &&
              finance.missingOnHoldExpectedAmountCount === 0
              ? true
              : finance.proofStatus === "PROVEN" ? false : null,
          }),
        },
        officialOnHoldAmount: snapshot?.officialOnHoldAmount ?? null,
        officialOnHoldCapturedAt: snapshot?.capturedAt ?? null,
        financeSnapshot: {
          capturedAt: snapshot?.capturedAt.toISOString() ?? null,
          currency: snapshot?.currency ?? shop.currency,
          availableBalance: snapshot?.availableBalance ?? null,
          frozenBalance: snapshot?.frozenBalance ?? null,
          totalBalance: snapshot?.totalBalance ?? null,
          toSettleBalance: snapshot?.toSettleBalance ?? null,
          onHoldBalance: snapshot?.onHoldBalance ?? null,
          officialOnHoldAmount: snapshot?.officialOnHoldAmount ?? null,
          settlementCount: statementCount,
          onHoldSettlementCount: onHoldCount,
        },
        sourceSyncRunId: shop.dataOrigin === "DEMO_SANITIZED"
          ? null
          : latestSuccessfulSync?.id ?? null,
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
      await recordAiDecision(
        db,
        toAiPersistenceInput(input.requestId, input.decisionCaseId, input.result),
      );
    },

    async recordBaDecision(input) {
      await recordBaDecisionForCase(db, {
        requestId: input.requestId,
        decisionCaseId: input.decisionCaseId,
        baDecision: {
          decision: input.decision,
          reasonCode: input.reasonCode,
          reasonCodes: [...input.reasonCodes],
          ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
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
      const record = await getDecisionReview(db, caseId);
      if (record === null) throw notFound("case", caseId);
      return record as PersistedDecisionReview;
    },

    async listDecisionHistory(input) {
      const shop = await findShopByProfileNo(db, input.profileNo);
      if (shop === null) throw notFound("shop", input.profileNo);
      const page = await listDecisionHistory(db, {
        profileNo: input.profileNo,
        caseOrigin: shop.dataOrigin,
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      });
      return page as {
        items: PersistedDecisionReview[];
        nextCursor: string | null;
      };
    },
  };
}

const unusedAiClient: BaselineAiClient = {
  async recommend() {
    throw new Error("AI client is not used by this workflow operation");
  },
};

export function createCliDecisionWorkflow(
  runtime: CliRuntime,
  dependencies: {
    readonly environment?: NodeJS.ProcessEnv;
    readonly now?: () => Date;
  } = {},
): DecisionWorkflow {
  const environment = dependencies.environment ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  const run = <T>(
    aiClient: BaselineAiClient,
    operation: (workflow: DecisionWorkflow) => Promise<T>,
  ): Promise<T> => withDatabase(runtime, ({ db }) => operation(createDecisionWorkflow({
    store: createDbDecisionWorkflowStore(db, now),
    aiClient,
    now,
  })));

  return {
    startReview(input) {
      const aiClient = createBaselineAiClientFromConfig(readBaselineAiConfig(environment));
      return run(aiClient, (workflow) => workflow.startReview(input));
    },
    show(caseId) {
      return run(unusedAiClient, (workflow) => workflow.show(caseId));
    },
    decide(input) {
      return run(unusedAiClient, (workflow) => workflow.decide(input));
    },
    execute(input) {
      return run(unusedAiClient, (workflow) => workflow.execute(input));
    },
    history(input) {
      return run(unusedAiClient, (workflow) => workflow.history(input));
    },
  };
}
