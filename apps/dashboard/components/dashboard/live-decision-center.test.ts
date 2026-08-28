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
  },
  metrics: [], comparisons: [], trends: [],
  rule: { result: "CONTINUE", policyVersion: "risk-policy.v1", expression: "Rule expression", evaluatedAt: "2026-08-16T01:00:00.000Z", triggers: [], checks: [] },
  ai: {
    status: "AVAILABLE", recommendation: "WATCH", riskLevel: "MEDIUM", confidence: "0.62",
    ruleAgreement: "AI differs from deterministic Rule", humanReviewRequired: "Yes", reasonCodes: [],
    supportingFactors: [], riskFactors: [], whatWouldChange: [], reason: "Advisory only.",
    policyVersion: "decision-ai-policy.v1", provider: "9router", requestedModel: "requested",
    reportedModel: "reported", actualModel: "actual", authMode: "LOCAL_NO_AUTH",
    promptVersion: "decision-ai-prompt.v2", outputSchemaVersion: "decision-ai-output.v1", failureCode: "None",
  },
  ba: { current: "NOT_REVIEWED", currentDetail: "No BA decision.", history: [] },
  execution: { status: "NOT_REQUESTED", requestedAction: "None", mode: "DRY_RUN only", sellerCenterCalled: "No", executedAt: "Not executed" },
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
  });
});
