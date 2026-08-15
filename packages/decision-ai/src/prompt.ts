import { BaDecisionReasonCodeSchema, BaDecisionSchema } from "@shop-health/domain";

import type { BaselineAiInput } from "./contracts.js";

export const DECISION_AI_PROMPT_VERSION = "decision-ai-prompt.v2" as const;
export const DECISION_AI_POLICY_VERSION = "decision-ai-policy.v1" as const;
export const DECISION_AI_OUTPUT_SCHEMA_VERSION = "decision-ai-output.v1" as const;

export function buildDecisionAiMessages(input: BaselineAiInput) {
  return [
    {
      role: "system" as const,
      content: [
        "Return only one JSON object matching the supplied output schema.",
        "You are advisory only; a Business Analyst makes the final decision.",
        "The deterministic Rule Result is immutable and must not be rewritten.",
        "Do not fabricate unavailable metrics. Unknown is not zero.",
        "Incomplete source coverage requires cautious confidence and human review.",
        "A complete rolling source window does not prove lifetime history completeness.",
        "Official Finance On Hold and operational order exposure are separate metrics.",
        "Provide concise rationale and evidence, not hidden chain-of-thought.",
      ].join(" "),
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        operationalMetrics: {
          totalPersistedOrders: input.metricsSnapshot.totalPersistedOrders ?? null,
          operationalOrderCount: input.metricsSnapshot.operationalOrderCount ?? null,
          onHoldOrderCount: input.metricsSnapshot.onHoldOrderCount,
          deliveredCount: input.metricsSnapshot.deliveredCount,
          deliveryRate: input.metricsSnapshot.deliveryRate,
          cancellationRate: input.metricsSnapshot.cancellationRate,
          refundRate: input.metricsSnapshot.refundRate,
          operationalOrderExposure: input.metricsSnapshot.onHoldValue,
          currency: input.metricsSnapshot.currency,
        },
        finance: {
          officialOnHoldAmount: input.financeSnapshot.officialOnHoldAmount,
          waitingForPackageDeliveryAmount: input.financeSnapshot.waitingForPackageDeliveryAmount ?? null,
          deliveredAwaitingSettlementAmount: input.financeSnapshot.deliveredAwaitingSettlementAmount ?? null,
          waitingForCompletedRefundReturnAmount: input.financeSnapshot.waitingForCompletedRefundReturnAmount ?? null,
          reasonTotalsReconcileToOfficialOnHold: input.financeSnapshot.reasonTotalsReconcileToOfficialOnHold ?? null,
          missingOnHoldExpectedAmountCount: input.financeSnapshot.missingOnHoldExpectedAmountCount ?? null,
          onHoldBalance: input.financeSnapshot.onHoldBalance,
          onHoldSettlementCount: input.financeSnapshot.onHoldSettlementCount,
          settlementCount: input.financeSnapshot.settlementCount,
          currency: input.financeSnapshot.currency,
        },
        coverage: input.coverageSnapshot,
        deterministicRule: {
          result: input.ruleDecision,
          triggers: input.ruleTriggers,
          policyVersion: input.riskSnapshot.policyVersion,
          dataSufficient: input.riskSnapshot.dataSufficient,
          stopByOnHoldValue: input.riskSnapshot.stopByOnHoldValue,
          stopByDeliveryRate: input.riskSnapshot.stopByDeliveryRate,
          currentValues: {
            onHoldValue: input.riskSnapshot.onHoldValue,
            deliveryRate: input.riskSnapshot.deliveryRate,
          },
          thresholds: {
            stopOnHoldValueAt: input.riskSnapshot.stopOnHoldValueAt,
            stopDeliveryRateBelow: input.riskSnapshot.stopDeliveryRateBelow,
            minimumOrdersForRateRule: input.riskSnapshot.minimumOrdersForRateRule,
          },
        },
        outputSchema: {
          recommendation: BaDecisionSchema.options,
          riskLevel: ["LOW", "MEDIUM", "HIGH"],
          confidence: "number from 0 to 1",
          reasonCodes: BaDecisionReasonCodeSchema.options,
          supportingFactors: "up to 5 concise evidence strings",
          riskFactors: "up to 5 concise risk strings",
          whatWouldChangeDecision: "up to 5 concise conditions",
          reason: "concise rationale, maximum 500 characters",
          humanReviewRequired: "boolean",
        },
      }),
    },
  ];
}
