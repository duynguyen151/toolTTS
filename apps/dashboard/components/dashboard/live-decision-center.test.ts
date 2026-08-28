import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DashboardDecisionCenter } from "../../lib/dashboard-contract.js";
import { LiveDecisionCenter } from "./live-decision-center.js";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const center: DashboardDecisionCenter = {
  status: "AVAILABLE",
  message: "Persisted decision evidence.",
  caseId: "case-1",
  profileNo: "118",
  reviewSnapshot: { owner: "IMMUTABLE_DECISION_CASE", source: "DECISION_CASE", businessTimeZone: "Asia/Bangkok", observedAt: "16 Aug 2026, 08:00 GMT+7" },
  financeHealth: null,
  coverage: {
    status: "PARTIAL",
    source: "SELLER_CENTER",
    provenWindow: "ROLLING_12_MONTHS",
    sourceReconciled: "Yes",
    freshness: "STALE",
    financeCapturedAt: "2026-08-16T00:00:00.000Z",
    financeAgeMs: 3_600_000,
    staleDisclosure: "STALE: Finance evidence is advisory only and is not current.",
    completeWithinWindow: "Yes",
    lifetimeHistory: "Not verified",
    evidence: { owner: "IMMUTABLE_DECISION_CASE", source: "DECISION_CASE", observedAt: "16 Aug 2026, 08:00 GMT+7" },
  },
  metrics: [], comparisons: [], trends: [],
  rule: {
    result: "CONTINUE", policyVersion: "risk-policy.v1", expression: "Rule expression", evaluatedAt: "2026-08-16T01:00:00.000Z", triggers: [], checks: [],
    conditions: {
      officialOnHold: { state: "CLEAR", source: "SELLER_CENTER", observedValue: "100", observedAt: "16 Aug 2026, 07:00 GMT+7", ageMs: 0, quality: "FRESH", threshold: "3500", evidence: { owner: "IMMUTABLE_DECISION_CASE", source: "DECISION_CASE", observedAt: "16 Aug 2026, 08:00 GMT+7" } },
      deliveryRate: { state: "NOT_EVALUATED", source: "SELLER_CENTER", observedValue: "Unavailable", observedAt: "Unavailable", ageMs: null, quality: "INCOMPLETE", threshold: "0.7", evidence: { owner: "IMMUTABLE_DECISION_CASE", source: "DECISION_CASE", observedAt: "16 Aug 2026, 08:00 GMT+7" } },
    },
    evidence: { owner: "IMMUTABLE_DECISION_CASE", source: "DECISION_CASE", observedAt: "16 Aug 2026, 08:00 GMT+7" },
  },
  ai: {
    status: "AVAILABLE", recommendation: "WATCH", riskLevel: "MEDIUM", confidence: "0.62",
    ruleAgreement: "AI differs from deterministic Rule", humanReviewRequired: "Yes", reasonCodes: [],
    supportingFactors: [], riskFactors: [], whatWouldChange: [], reason: "Advisory only.",
    policyVersion: "decision-ai-policy.v1", provider: "9router", requestedModel: "requested",
    reportedModel: "reported", actualModel: "actual", authMode: "LOCAL_NO_AUTH",
    promptVersion: "decision-ai-prompt.v2", outputSchemaVersion: "decision-ai-output.v1", failureCode: "None",
    evidence: { owner: "AI_DECISION", source: "AI_DECISION", observedAt: "16 Aug 2026, 08:01 GMT+7" },
  },
  ba: { current: "NOT_REVIEWED", currentDetail: "No BA decision.", evidence: { owner: "BA_DECISION_REVISION", source: "BA_DECISION", observedAt: "Unavailable" }, history: [] },
  execution: { status: "NOT_REQUESTED", requestedAction: "None", mode: "DRY_RUN only", sellerCenterCalled: "No", executedAt: "Not executed", evidence: { owner: "DRY_RUN_EXECUTION", source: "DECISION_EXECUTION", observedAt: "Unavailable" } },
  reviewQueue: [],
};

describe("LiveDecisionCenter", () => {
  it("renders structured stale Finance and AI-versus-Rule disclosures", () => {
    const html = renderToStaticMarkup(createElement(LiveDecisionCenter, { dataOrigin: "LIVE", center }));

    expect(html).toContain("Finance captured");
    expect(html).toContain("2026-08-16T00:00:00.000Z");
    expect(html).toContain("3600000 ms");
    expect(html).toContain("STALE: Finance evidence is advisory only and is not current.");
    expect(html).toContain("Rule agreement");
    expect(html).toContain("AI differs from deterministic Rule");
    expect(html).toContain("Immutable Decision Case");
    expect(html).toContain("Linked AI Decision");
    expect(html).toContain("BA decision revisions");
    expect(html).toContain("Official On Hold condition");
    expect(html).toContain("NOT_EVALUATED");
  });

  it("renders all persisted tri-state Rule condition states without recomputation", () => {
    const states = ["TRIGGERED", "CLEAR", "NOT_EVALUATED"] as const;
    for (const state of states) {
      const html = renderToStaticMarkup(createElement(LiveDecisionCenter, {
        dataOrigin: "LIVE",
        center: {
          ...center,
          rule: {
            ...center.rule,
            conditions: {
              ...center.rule.conditions,
              officialOnHold: { ...center.rule.conditions.officialOnHold, state },
            },
          },
        },
      }));
      expect(html).toContain(state);
    }
  });

  it("renders persisted SLOW_SELL methods as intent without an execution control", () => {
    const html = renderToStaticMarkup(createElement(LiveDecisionCenter, {
      dataOrigin: "LIVE",
      center: {
        ...center,
        ba: {
          ...center.ba,
          current: "SLOW_SELL",
          history: [{
            decision: "SLOW_SELL",
            reason: "LOW_DELIVERY_RATE",
            actor: "operator",
            decidedAt: "16 Aug 2026, 09:00 GMT+7",
            notes: "Review a further operator-led method.",
            plannedMethods: ["DISABLE_FLASH_SALE", "OTHER"],
            evidence: center.ba.evidence,
          }],
        },
      },
    }));

    expect(html).toContain("DISABLE_FLASH_SALE");
    expect(html).toContain("OTHER");
    expect(html).not.toContain("Execute SLOW_SELL");
  });
});
