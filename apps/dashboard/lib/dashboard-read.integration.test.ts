import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeDatabase,
  createDatabase,
  createDecisionCase,
  recordAiDecision,
  type DatabaseContext,
} from "@shop-health/db";
import { shops } from "@shop-health/db";

import { loadDashboardPresentation } from "./dashboard-read.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl === undefined ? describe.skip : describe;

describeWithDatabase("dashboard persisted decision read", () => {
  let context: DatabaseContext;
  const profileNo = `DASHBOARD-${randomUUID()}`;
  let shopId: string | undefined;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    context = createDatabase(testDatabaseUrl!);
    process.env.DATABASE_URL = testDatabaseUrl;
  });

  afterAll(async () => {
    if (context !== undefined && shopId !== undefined) {
      await context.sql`delete from ai_decisions where decision_case_id in (select id from decision_cases where shop_id = ${shopId})`;
      await context.sql`delete from ba_decisions where decision_case_id in (select id from decision_cases where shop_id = ${shopId})`;
      await context.sql`delete from decision_executions where decision_case_id in (select id from decision_cases where shop_id = ${shopId})`;
      await context.sql`delete from decision_cases where shop_id = ${shopId}`;
      await context.sql`delete from shops where id = ${shopId}`;
    }
    if (context !== undefined) await closeDatabase(context);
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("reads distinct persisted Rule and AI layers with full 9Router model provenance", async () => {
    const now = new Date();
    const periodStart = new Date(now.getTime() - 86_400_000);
    const [shop] = await context.db.insert(shops).values({
      profileId: profileNo,
      profileNo,
      displayName: "Dashboard integration shop",
      region: "US",
      locale: "en-US",
      currency: "USD",
      enabled: true,
      syncState: "ACTIVE",
    }).returning();
    if (shop === undefined) throw new Error("Dashboard integration shop was not created");
    shopId = shop.id;

    const decisionCase = await createDecisionCase(context.db, {
      requestId: randomUUID(),
      caseOrigin: "LIVE",
      shopId: shop.id,
      observedAt: now,
      metricsSnapshot: {
        window: "FULL_PERSISTED_HISTORY",
        periodStart: periodStart.toISOString(),
        periodEnd: now.toISOString(),
        totalOrders: 30,
        totalPersistedOrders: 30,
        operationalOrderCount: 12,
        onHoldOrderCount: 4,
        deliveredCount: 20,
        deliveryRate: 20 / 30,
        cancellationRate: null,
        refundRate: null,
        onHoldValue: "125.0000",
        currency: "USD",
      },
      riskSnapshot: {
        policyVersion: "risk-control-policy.v1",
        evaluatedAt: now.toISOString(),
        onHoldValue: "125.0000",
        deliveryRate: 20 / 30,
        stopByOnHoldValue: false,
        stopByDeliveryRate: true,
        dataSufficient: true,
        stopOnHoldValueAt: "3500.0000",
        stopDeliveryRateBelow: 0.7,
        minimumOrdersForRateRule: 25,
      },
      financeSnapshot: {
        capturedAt: now.toISOString(),
        currency: "USD",
        availableBalance: null,
        frozenBalance: null,
        totalBalance: null,
        toSettleBalance: null,
        onHoldBalance: null,
        officialOnHoldAmount: null,
        settlementCount: 0,
        onHoldSettlementCount: 0,
      },
      coverageSnapshot: {
        coverageState: "COMPLETE",
        persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
        provenSourceWindow: "ROLLING_12_MONTHS",
        completeWithinSourceWindow: true,
        lifetimeHistoryComplete: false,
        ordersSourceComplete: true,
        financeRequiredSourceComplete: true,
        sourceReconciled: true,
        latestSuccessfulSyncAt: now.toISOString(),
        financeCapturedAt: now.toISOString(),
        freshness: "FRESH",
      },
      ruleDecision: "PAUSE",
      ruleTriggers: ["DELIVERY_RATE"],
      dataCoverage: "COMPLETE",
      sourceSyncRunId: null,
    });
    await recordAiDecision(context.db, {
      requestId: randomUUID(),
      decisionCaseId: decisionCase.id,
      status: "AVAILABLE",
      provider: "9router",
      model: "deepseek-v4-flash-free",
      requestedModel: "oc/deepseek-v4-flash-free",
      reportedModel: "deepseek-v4-flash-free",
      actualModelUsed: "deepseek-v4-flash-free",
      authMode: "LOCAL_NO_AUTH",
      outputSchemaVersion: "decision-ai-output.v1",
      promptVersion: "decision-ai-prompt.v2",
      policyVersion: "risk-control-policy.v1",
      aiPolicyVersion: "decision-ai-policy.v1",
      recommendation: "WATCH",
      riskLevel: "HIGH",
      confidence: 0.91,
      ruleOverride: true,
      reasonCodes: ["LOW_DELIVERY_RATE"],
      supportingFactors: ["Orders and finance are reconciled."],
      riskFactors: ["Delivery rate is below policy threshold."],
      whatWouldChangeDecision: ["Delivery rate above threshold."],
      reason: "BA review remains required.",
      humanReviewRequired: true,
      failureCode: null,
    });

    const presentation = await loadDashboardPresentation();
    const rule = presentation.decisionTrace.find((stage) => stage.id === "rule");
    const ai = presentation.decisionTrace.find((stage) => stage.id === "ai");

    expect(presentation.selectedShop.profileNo).toBe(profileNo);
    expect(rule).toMatchObject({ label: "Rule Result", value: "Ready" });
    expect(rule?.detail).toContain("Result: PAUSE.");
    expect(ai).toMatchObject({ label: "AI Recommendation", value: "Ready" });
    expect(ai?.detail).toContain("Recommendation: WATCH.");
    expect(ai?.detail).toContain("Provider: 9router.");
    expect(ai?.detail).toContain("Requested model: oc/deepseek-v4-flash-free.");
    expect(ai?.detail).toContain("Reported model: deepseek-v4-flash-free.");
    expect(ai?.detail).toContain("Actual model: deepseek-v4-flash-free.");
  });
});
