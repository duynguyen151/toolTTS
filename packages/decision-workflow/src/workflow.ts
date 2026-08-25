import { randomUUID } from "node:crypto";

import {
  BaDecisionInputSchema,
  evaluateRiskControlFacts,
  mapRiskResultToRuleDecision,
  toRiskControlPolicy,
  type DecisionCaseInput,
  type DecisionFinanceSnapshot,
  type DecisionCoverageSnapshot,
  type DecisionMetricsSnapshot,
  type DecisionRiskSnapshot,
  type DecisionRuleTrigger,
  type RiskOrderFact,
  type AiDecisionContext,
  type ResolvedRiskPolicySnapshot,
} from "@shop-health/domain";
import type {
  BaselineAiClient,
  BaselineAiInputRecord,
  BaselineAiResult,
} from "@shop-health/decision-ai";
import type { BaDecision, BaDecisionReasonCode } from "@shop-health/domain";

import {
  toDecisionHistoryPage,
  toDecisionReviewView,
  type DataOrigin,
  type DecisionHistoryPage,
  type DecisionReviewView,
  type PersistedDecisionReview,
} from "./presentation.js";
import { buildDecisionIntelligence } from "./decision-intelligence.js";

export interface ReviewStartSource {
  readonly shop: PersistedDecisionReview["shop"];
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly facts: readonly RiskOrderFact[];
  readonly financeSnapshot: DecisionFinanceSnapshot;
  readonly coverageSnapshot?: DecisionCoverageSnapshot;
  readonly sourceSyncRunId: string | null;
  readonly holidayModeCurrentlyEnabled: boolean | null;
  readonly consecutiveSafeCycles: number;
  readonly decisionIdentity: {
    readonly profileId: string;
    readonly tiktokShopId: string | null;
    readonly region: "US";
    readonly locale: "en-US";
  };
  readonly previousDecisionContext: AiDecisionContext | null;
  readonly resolvedPolicySnapshot: ResolvedRiskPolicySnapshot;
}

export interface DecisionWorkflowStore {
  getDecisionReviewByRequestId(requestId: string): Promise<PersistedDecisionReview | null>;
  getDecisionAiInput(caseId: string): Promise<BaselineAiInputRecord>;
  loadReviewStartSource(profileNo: string, effectiveAt: Date): Promise<ReviewStartSource>;
  createDecisionCase(input: {
    readonly requestId: string;
    readonly caseOrigin: DataOrigin;
    readonly decisionCase: DecisionCaseInput;
  }): Promise<{ readonly caseId: string }>;
  recordAiDecision(input: {
    readonly requestId: string;
    readonly decisionCaseId: string;
    readonly result: BaselineAiResult;
  }): Promise<void>;
  recordBaDecision(input: {
    readonly decisionCaseId: string;
    readonly decision: BaDecision;
    readonly reasonCode: BaDecisionReasonCode;
    readonly confidence?: number;
    readonly reasonCodes: readonly BaDecisionReasonCode[];
    readonly note?: string;
    readonly requestId: string;
  }): Promise<void>;
  recordDryRunExecution(input: {
    readonly baDecisionId: string;
    readonly decisionCaseId: string;
    readonly requestId: string;
  }): Promise<void>;
  getDecisionReview(caseId: string): Promise<PersistedDecisionReview>;
  listDecisionHistory(input: {
    readonly profileNo: string;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<{ readonly items: readonly PersistedDecisionReview[]; readonly nextCursor: string | null }>;
}

export type DecisionWorkflowErrorCode =
  | "CONFIRMATION_REQUIRED"
  | "BA_DECISION_REQUIRED"
  | "PAUSE_DECISION_REQUIRED"
  | "REQUEST_ID_PROFILE_MISMATCH";

export class DecisionWorkflowError extends Error {
  readonly code: DecisionWorkflowErrorCode;

  constructor(code: DecisionWorkflowErrorCode, message: string) {
    super(message);
    this.name = "DecisionWorkflowError";
    this.code = code;
  }
}

export interface DecisionWorkflow {
  startReview(input: { readonly profileNo: string; readonly requestId?: string }): Promise<DecisionReviewView>;
  show(caseId: string): Promise<DecisionReviewView>;
  decide(input: {
    readonly caseId: string;
    readonly decision: BaDecision;
    readonly confidence?: number;
    readonly reasonCodes?: readonly BaDecisionReasonCode[];
    readonly reasonCode: BaDecisionReasonCode;
    readonly note?: string;
    readonly notes?: string;
    readonly requestId?: string;
  }): Promise<DecisionReviewView>;
  execute(input: { readonly caseId: string; readonly confirm: boolean; readonly requestId?: string }): Promise<DecisionReviewView>;
  history(input: { readonly profileNo: string; readonly limit?: number; readonly cursor?: string }): Promise<DecisionHistoryPage>;
}

function ruleTriggers(trigger: "VALUE" | "RATE" | "BOTH" | "NONE"): DecisionRuleTrigger[] {
  switch (trigger) {
    case "VALUE":
      return ["ONHOLD_VALUE"];
    case "RATE":
      return ["DELIVERY_RATE"];
    case "BOTH":
      return ["ONHOLD_VALUE", "DELIVERY_RATE"];
    case "NONE":
      return [];
  }
}

export function createDecisionWorkflow(dependencies: {
  readonly store: DecisionWorkflowStore;
  readonly aiClient: BaselineAiClient;
  readonly now?: () => Date;
  readonly randomUuid?: () => string;
}): DecisionWorkflow {
  const now = dependencies.now ?? (() => new Date());
  const newRequestId = dependencies.randomUuid ?? randomUUID;
  const completeAi = async (caseId: string, requestId: string): Promise<DecisionReviewView> => {
    const aiInput = await dependencies.store.getDecisionAiInput(caseId);
    const aiResult = await dependencies.aiClient.recommend(aiInput);
    await dependencies.store.recordAiDecision({
      requestId,
      decisionCaseId: caseId,
      result: aiResult,
    });
    return toDecisionReviewView(await dependencies.store.getDecisionReview(caseId));
  };

  return {
    async startReview(input) {
      if (input.requestId !== undefined) {
        const existing = await dependencies.store.getDecisionReviewByRequestId(input.requestId);
        if (existing !== null) {
          if (existing.shop.profileNo !== input.profileNo) {
            throw new DecisionWorkflowError(
              "REQUEST_ID_PROFILE_MISMATCH",
              "Review request ID belongs to another shop profile",
            );
          }
          return existing.ai === null
            ? completeAi(existing.case.id, input.requestId)
            : toDecisionReviewView(existing);
        }
      }
      const observedAt = now();
      const source = await dependencies.store.loadReviewStartSource(input.profileNo, observedAt);
      const requestId = input.requestId ?? newRequestId();
      const risk = evaluateRiskControlFacts({
        facts: source.facts,
        policy: toRiskControlPolicy(source.resolvedPolicySnapshot),
        holidayModeCurrentlyEnabled: source.holidayModeCurrentlyEnabled,
        consecutiveSafeCycles: source.consecutiveSafeCycles,
      });
      const metricsSnapshot: DecisionMetricsSnapshot = {
        window: "FULL_PERSISTED_HISTORY",
        periodStart: source.periodStart.toISOString(),
        periodEnd: source.periodEnd.toISOString(),
        totalOrders: risk.totalPersistedOrderCount,
        totalPersistedOrders: risk.totalPersistedOrders,
        operationalOrderCount: risk.operationalOrderCount,
        onHoldOrderCount: risk.onHoldOrderCount,
        deliveredCount: risk.deliveredCount,
        deliveryRate: risk.deliveryRate,
        cancellationRate: null,
        refundRate: null,
        onHoldValue: risk.onHoldValue,
        currency: risk.currency,
      };
      const riskSnapshot: DecisionRiskSnapshot = {
        policyVersion: risk.policyVersion,
        evaluatedAt: observedAt.toISOString(),
        onHoldValue: risk.onHoldValue,
        deliveryRate: risk.deliveryRate,
        stopByOnHoldValue: risk.stopByOnHoldValue,
        stopByDeliveryRate: risk.stopByDeliveryRate,
        dataSufficient: risk.dataSufficient,
        stopOnHoldValueAt: risk.thresholds.stopOnHoldValueAt,
        stopDeliveryRateBelow: risk.thresholds.stopDeliveryRateBelow,
        minimumOrdersForRateRule: risk.thresholds.minimumOrdersForRateRule,
      };
      const ruleDecision = mapRiskResultToRuleDecision(risk.ruleResult);
      const triggers = ruleTriggers(risk.trigger);
      const decisionContextSnapshot = buildDecisionIntelligence({
        observedAt,
        profile: { profileId: source.decisionIdentity.profileId, profileNo: source.shop.profileNo },
        shop: {
          shopId: source.shop.id,
          tiktokShopId: source.decisionIdentity.tiktokShopId,
          displayName: source.shop.displayName,
          region: source.decisionIdentity.region,
          locale: source.decisionIdentity.locale,
          currency: "USD",
        },
        metrics: metricsSnapshot,
        finance: source.financeSnapshot,
        coverage: source.coverageSnapshot ?? {
          coverageState: source.shop.dataCoverage,
          persistedMetricsWindow: metricsSnapshot.window,
          source: null,
          provenSourceWindow: null,
          completeWithinSourceWindow: null,
          lifetimeHistoryComplete: null,
        },
        risk: riskSnapshot,
        ruleDecision,
        ruleTriggers: triggers,
        previous: source.previousDecisionContext,
      }).context;
      const created = await dependencies.store.createDecisionCase({
        requestId,
        caseOrigin: source.shop.dataOrigin,
        decisionCase: {
          shopId: source.shop.id,
          observedAt,
          metricsSnapshot,
          riskSnapshot,
          financeSnapshot: source.financeSnapshot,
          coverageSnapshot: source.coverageSnapshot ?? {
            coverageState: source.shop.dataCoverage,
            persistedMetricsWindow: metricsSnapshot.window,
            source: null,
            provenSourceWindow: null,
            completeWithinSourceWindow: null,
            lifetimeHistoryComplete: null,
          },
          ruleDecision,
          ruleTriggers: triggers,
          dataCoverage: source.shop.dataCoverage,
          sourceSyncRunId: source.sourceSyncRunId,
          resolvedPolicySnapshot: source.resolvedPolicySnapshot,
          decisionContextSnapshot,
        },
      });
      const persisted = await dependencies.store.getDecisionReview(created.caseId);
      return persisted.ai === null
        ? completeAi(created.caseId, requestId)
        : toDecisionReviewView(persisted);
    },

    async show(caseId) {
      return toDecisionReviewView(await dependencies.store.getDecisionReview(caseId));
    },

    async decide(input) {
      const parsed = BaDecisionInputSchema.parse({
        decision: input.decision,
        confidence: input.confidence,
        reasonCode: input.reasonCode,
        reasonCodes: input.reasonCodes,
        note: input.note,
        notes: input.notes,
      });
      const reasonCodes = parsed.reasonCodes ?? [parsed.reasonCode];
      await dependencies.store.recordBaDecision({
        requestId: input.requestId ?? newRequestId(),
        decisionCaseId: input.caseId,
        decision: parsed.decision,
        reasonCode: parsed.reasonCode,
        ...(parsed.confidence === undefined ? {} : { confidence: parsed.confidence }),
        reasonCodes,
        ...(parsed.note === undefined ? {} : { note: parsed.note }),
      });
      return toDecisionReviewView(await dependencies.store.getDecisionReview(input.caseId));
    },

    async execute(input) {
      if (!input.confirm) {
        throw new DecisionWorkflowError(
          "CONFIRMATION_REQUIRED",
          "DRY_RUN execution requires explicit confirmation",
        );
      }
      const current = await dependencies.store.getDecisionReview(input.caseId);
      if (current.ba === null) {
        throw new DecisionWorkflowError(
          "BA_DECISION_REQUIRED",
          "A BA decision is required before execution",
        );
      }
      if (current.ba.decision !== "PAUSE") {
        throw new DecisionWorkflowError(
          "PAUSE_DECISION_REQUIRED",
          "Only a PAUSE BA decision can request Holiday Mode DRY_RUN execution",
        );
      }
      await dependencies.store.recordDryRunExecution({
        baDecisionId: current.ba.id,
        decisionCaseId: input.caseId,
        requestId: input.requestId ?? newRequestId(),
      });
      return toDecisionReviewView(await dependencies.store.getDecisionReview(input.caseId));
    },

    async history(input) {
      const page = await dependencies.store.listDecisionHistory({
        profileNo: input.profileNo,
        limit: input.limit ?? 20,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      });
      return toDecisionHistoryPage(page);
    },
  };
}
