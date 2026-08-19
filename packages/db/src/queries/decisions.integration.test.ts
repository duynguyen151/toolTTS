import { randomUUID } from "node:crypto";

process.env.TOOL_BA_ACTOR = "test-ba";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import { orders, shops, syncRuns } from "../schema.js";
import { getFullPersistedRiskOrderFacts } from "./orders.js";
import { findLatestSuccessfulSyncRun } from "./sync-runs.js";
import {
  createDecisionCase,
  getDecisionAiInput,
  getDecisionReview,
  getDecisionReviewByRequestId,
  listDecisionHistory,
  recordAiDecision,
  recordBaDecisionForCase,
  recordDryRunExecution,
} from "./decisions.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function unavailableAi(requestId: string, decisionCaseId: string, failureCode: "CONFIG_MISSING" | "TIMEOUT") {
  return {
    requestId,
    decisionCaseId,
    status: "UNAVAILABLE" as const,
    provider: "9router",
    model: null,
    requestedModel: "oc/deepseek-v4-flash-free",
    reportedModel: null,
    actualModelUsed: null,
    authMode: "LOCAL_NO_AUTH" as const,
    outputSchemaVersion: "decision-ai-output.v1" as const,
    promptVersion: "decision-ai-prompt.v2",
    policyVersion: "risk-control-policy.v1",
    aiPolicyVersion: "decision-ai-policy.v1",
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
    failureCode,
  };
}

describeWithDatabase("decision workflow PostgreSQL integration", () => {
  let context: DatabaseContext;
  const profileNo = `TEST-${randomUUID()}`;
  const demoProfileNo = `DEMO-${randomUUID()}`;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
  });

  afterAll(async () => {
    if (!context) return;
    // BA decisions are immutable, so integration audit records intentionally remain in TEST_DATABASE_URL.
    await closeDatabase(context);
  });

  it("persists an idempotent case, fail-closed AI, BA PAUSE, and DRY_RUN history", async () => {
    const [shop] = await context.db.insert(shops).values({
      profileId: profileNo,
      profileNo,
      displayName: "Integration Shop",
      region: "US",
      locale: "en-US",
      currency: "USD",
    }).returning();
    await context.db.insert(orders).values([
      {
        shopId: shop!.id,
        sourceOrderId: `FIRST-${randomUUID()}`,
        sourceStatus: "Delivered",
        canonicalStatus: "DELIVERED",
        grandTotal: "10.0000",
        currency: "USD",
        sourceHash: randomUUID(),
        sourceSchemaVersion: "integration.v1",
        firstSeenAt: new Date("2026-08-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-08-10T00:00:00.000Z"),
      },
      {
        shopId: shop!.id,
        sourceOrderId: `LAST-${randomUUID()}`,
        sourceStatus: "Delivered",
        canonicalStatus: "DELIVERED",
        grandTotal: "20.0000",
        currency: "USD",
        sourceHash: randomUUID(),
        sourceSchemaVersion: "integration.v1",
        firstSeenAt: new Date("2026-08-03T00:00:00.000Z"),
        lastSeenAt: new Date("2026-08-14T00:00:00.000Z"),
      },
    ]);
    await expect(getFullPersistedRiskOrderFacts(context.db, shop!.id)).resolves.toEqual([
      expect.objectContaining({
        firstObservedAt: new Date("2026-08-01T00:00:00.000Z"),
        lastObservedAt: new Date("2026-08-14T00:00:00.000Z"),
      }),
    ]);

    const caseRequestId = randomUUID();
    const caseInput = {
      requestId: caseRequestId,
      caseOrigin: "LIVE" as const,
      shopId: shop!.id,
      observedAt: new Date("2026-08-14T00:00:00.000Z"),
      metricsSnapshot: {
        window: "FULL_PERSISTED_HISTORY",
        periodStart: "2026-08-01T00:00:00.000Z",
        periodEnd: "2026-08-14T00:00:00.000Z",
        totalOrders: 12,
        onHoldOrderCount: 5,
        deliveredCount: 7,
        deliveryRate: 7 / 12,
        cancellationRate: null,
        refundRate: null,
        onHoldValue: "500.0000",
        currency: "USD",
      },
      riskSnapshot: {
        policyVersion: "risk-control-policy.v1",
        evaluatedAt: "2026-08-14T00:00:00.000Z",
        onHoldValue: "500.0000",
        deliveryRate: 7 / 12,
        stopByOnHoldValue: false,
        stopByDeliveryRate: true,
        dataSufficient: true,
        stopOnHoldValueAt: "4321.0000",
        stopDeliveryRateBelow: 0.73,
        minimumOrdersForRateRule: 25,
      },
      financeSnapshot: {
        capturedAt: null,
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
        coverageState: "UNKNOWN" as const,
        persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
        provenSourceWindow: null,
        completeWithinSourceWindow: null,
        lifetimeHistoryComplete: null,
      },
      ruleDecision: "PAUSE" as const,
      ruleTriggers: ["DELIVERY_RATE" as const],
      dataCoverage: "UNKNOWN" as const,
      sourceSyncRunId: null,
    };
    const {
      stopOnHoldValueAt: _stopOnHoldValueAt,
      stopDeliveryRateBelow: _stopDeliveryRateBelow,
      minimumOrdersForRateRule: _minimumOrdersForRateRule,
      ...riskSnapshotWithoutThresholds
    } = caseInput.riskSnapshot;
    await expect(context.sql`
      insert into decision_cases (
        request_id, shop_id, case_origin, observed_at,
        metrics_snapshot, risk_snapshot, finance_snapshot,
        rule_decision, rule_triggers, data_coverage, source_sync_run_id
      ) values (
        ${randomUUID()}, ${shop!.id}, 'LIVE', ${caseInput.observedAt.toISOString()},
        ${JSON.stringify(caseInput.metricsSnapshot)}::jsonb,
        ${JSON.stringify(riskSnapshotWithoutThresholds)}::jsonb,
        ${JSON.stringify(caseInput.financeSnapshot)}::jsonb,
        ${caseInput.ruleDecision}, ${JSON.stringify(caseInput.ruleTriggers)}::jsonb,
        ${caseInput.dataCoverage}, null
      )
    `).rejects.toMatchObject({
      constraint_name: "decision_cases_risk_thresholds_present",
    });
    const firstCase = await createDecisionCase(context.db, caseInput);
    await expect(context.sql`
      update decision_cases set rule_decision = 'CONTINUE' where id = ${firstCase.id}
    `).rejects.toThrow("decision_cases are append-only");
    const retriedCase = await createDecisionCase(context.db, caseInput);
    expect(retriedCase.id).toBe(firstCase.id);
    const retriedAfterFactsChanged = await createDecisionCase(context.db, {
      ...caseInput,
      observedAt: new Date("2026-08-14T00:10:00.000Z"),
      metricsSnapshot: { ...caseInput.metricsSnapshot, totalOrders: 13 },
    });
    expect(retriedAfterFactsChanged.id).toBe(firstCase.id);
    await expect(getDecisionAiInput(context.db, firstCase.id)).resolves.toEqual({
      metricsSnapshot: caseInput.metricsSnapshot,
      financeSnapshot: {
        ...caseInput.financeSnapshot,
        waitingForCompletedRefundReturnAmount: null,
      },
      coverageSnapshot: caseInput.coverageSnapshot,
      riskSnapshot: caseInput.riskSnapshot,
      ruleDecision: "PAUSE",
      ruleTriggers: ["DELIVERY_RATE"],
      decisionContextSnapshot: null,
    });
    await expect(getDecisionReviewByRequestId(context.db, caseRequestId)).resolves.toMatchObject({
      case: { id: firstCase.id },
      ai: null,
    });

    const aiRequestId = randomUUID();
    await recordAiDecision(context.db, unavailableAi(aiRequestId, firstCase.id, "CONFIG_MISSING"));
    await expect(recordAiDecision(
      context.db,
      unavailableAi(aiRequestId, firstCase.id, "TIMEOUT"),
    )).resolves.toMatchObject({
      id: expect.any(String),
      failureCode: "CONFIG_MISSING",
    });
    await expect(recordAiDecision(
      context.db,
      unavailableAi(randomUUID(), firstCase.id, "TIMEOUT"),
    )).resolves.toMatchObject({
      id: expect.any(String),
      requestId: aiRequestId,
      failureCode: "CONFIG_MISSING",
    });
    const baRequestId = randomUUID();
    const baDecision = await recordBaDecisionForCase(context.db, {
      requestId: baRequestId,
      decisionCaseId: firstCase.id,
      baDecision: {
        decision: "PAUSE",
        reasonCode: "LOW_DELIVERY_RATE",
        reasonCodes: ["LOW_DELIVERY_RATE"],
        note: "Confirm dry run only",
      },
    });
    await expect(context.sql`
      update ba_decisions set note = 'attempted overwrite' where id = ${baDecision.id}
    `).rejects.toThrow("ba_decisions is append-only");
    await expect(context.sql`
      delete from ba_decisions where id = ${baDecision.id}
    `).rejects.toThrow("ba_decisions is append-only");
    await expect(recordBaDecisionForCase(context.db, {
      requestId: baRequestId,
      decisionCaseId: firstCase.id,
      baDecision: { decision: "WATCH", reasonCode: "OTHER", reasonCodes: ["OTHER"], notes: "Different retry input" },
    })).rejects.toThrow("different input");
    const latestBaDecision = await recordBaDecisionForCase(context.db, {
      requestId: randomUUID(),
      decisionCaseId: firstCase.id,
      baDecision: { decision: "WATCH", reasonCode: "OTHER", reasonCodes: ["OTHER"], notes: "Other reason" },
    });
    expect((await getDecisionReview(context.db, firstCase.id))?.ba).toMatchObject({
      id: latestBaDecision.id,
      decision: "WATCH",
    });
    expect((await getDecisionReview(context.db, firstCase.id))?.baHistory.map((revision) => revision.id)).toEqual([
      latestBaDecision.id,
      baDecision.id,
    ]);

    const executionRequestId = randomUUID();
    const execution = await recordDryRunExecution(context.db, {
      requestId: executionRequestId,
      decisionCaseId: firstCase.id,
      baDecisionId: baDecision.id,
      requestedAction: "HOLIDAY_MODE_ON",
      executionMode: "DRY_RUN",
    });
    const retriedExecution = await recordDryRunExecution(context.db, {
      requestId: executionRequestId,
      decisionCaseId: firstCase.id,
      baDecisionId: baDecision.id,
      requestedAction: "HOLIDAY_MODE_ON",
      executionMode: "DRY_RUN",
    });
    expect(retriedExecution.id).toBe(execution.id);

    const review = await getDecisionReview(context.db, firstCase.id);
    expect(review).toMatchObject({
      case: { origin: "LIVE" },
      rule: {
        thresholds: {
          stopOnHoldValueAt: "4321.0000",
          stopDeliveryRateBelow: 0.73,
          minimumOrdersForRateRule: 25,
        },
      },
      ai: { status: "UNAVAILABLE", failureCode: "CONFIG_MISSING" },
      ba: { id: latestBaDecision.id, decision: "WATCH" },
      execution: {
        requestedAction: "HOLIDAY_MODE_ON",
        mode: "DRY_RUN",
        status: "SIMULATED",
        sellerCenterCalled: false,
      },
    });
    expect(review?.events.map(({ type }) => type)).toEqual([
      "CASE_STARTED",
      "AI_RECORDED",
      "BA_DECIDED",
      "DRY_RUN_EXECUTED",
    ]);
    const revisionCreatedAt = new Date("2027-01-01T00:00:00.000Z");
    const revisionIds = [randomUUID(), randomUUID()].sort();
    const legacyRevisionId = revisionIds[0]!;
    const currentRevisionId = revisionIds[1]!;
    await context.sql`
      insert into ba_decisions (id, request_id, decision_case_id, decision, reason_codes, created_at)
      values (
        ${legacyRevisionId}, ${randomUUID()}, ${firstCase.id}, 'PAUSE',
        ${JSON.stringify(["LOW_DELIVERY_RATE"])}::jsonb, ${revisionCreatedAt.toISOString()}
      )
    `;
    await context.sql`
      insert into ba_decisions (id, request_id, decision_case_id, decision, reason_codes, created_at)
      values (
        ${currentRevisionId}, ${randomUUID()}, ${firstCase.id}, 'PAUSE',
        ${JSON.stringify(["LOW_DELIVERY_RATE"])}::jsonb, ${revisionCreatedAt.toISOString()}
      )
    `;
    expect((await getDecisionReview(context.db, firstCase.id))?.ba).toMatchObject({
      id: currentRevisionId,
      actor: "LEGACY_UNATTRIBUTED",
    });

    const olderCase = await createDecisionCase(context.db, {
      ...caseInput,
      requestId: randomUUID(),
      observedAt: new Date("2026-08-13T23:00:00.000Z"),
      metricsSnapshot: {
        ...caseInput.metricsSnapshot,
        periodEnd: "2026-08-13T23:00:00.000Z",
      },
      riskSnapshot: {
        ...caseInput.riskSnapshot,
        evaluatedAt: "2026-08-13T23:00:00.000Z",
      },
    });
    await expect(recordAiDecision(
      context.db,
      unavailableAi(aiRequestId, olderCase.id, "CONFIG_MISSING"),
    )).rejects.toThrow("another decision case");
    await expect(context.sql`
      insert into ai_decisions (
        request_id, decision_case_id, status, provider, model,
        prompt_version, policy_version, human_review_required, failure_code
      ) values (
        ${randomUUID()}, ${olderCase.id}, 'UNAVAILABLE', 'opencode-zen',
        'deepseek-v4-flash-free', 'baseline-ai-prompt.v1',
        'risk-control-policy.v1', true, 'raw provider error'
      )
    `).rejects.toThrow();
    await recordAiDecision(context.db, {
      requestId: randomUUID(),
      decisionCaseId: olderCase.id,
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
      riskLevel: "MEDIUM",
      confidence: 0.8,
      ruleOverride: true,
      reasonCodes: ["DATA_INCOMPLETE"],
      supportingFactors: ["Delivery remains above the deterministic threshold."],
      riskFactors: ["Coverage remains unknown."],
      whatWouldChangeDecision: ["Verified complete coverage."],
      reason: "Persisted history requires BA review.",
      humanReviewRequired: true,
      failureCode: null,
    });
    const watchBaDecision = await recordBaDecisionForCase(context.db, {
      requestId: randomUUID(),
      decisionCaseId: olderCase.id,
      baDecision: { decision: "WATCH", reasonCode: "DATA_INCOMPLETE", reasonCodes: ["DATA_INCOMPLETE"] },
    });
    await expect(context.sql`
      insert into decision_executions (
        request_id, decision_case_id, ba_decision_id,
        requested_action, execution_mode, execution_status, seller_center_called
      ) values (
        ${randomUUID()}, ${olderCase.id}, ${watchBaDecision.id},
        'HOLIDAY_MODE_ON', 'DRY_RUN', 'SIMULATED', false
      )
    `).rejects.toMatchObject({
      constraint_name: "decision_executions_ba_case_decision_fk",
    });
    const persistedAvailableReview = await getDecisionReview(context.db, olderCase.id);
    expect(persistedAvailableReview).toMatchObject({
      ai: {
        status: "AVAILABLE",
        recommendation: "WATCH",
        confidence: 0.8,
        provider: "9router",
        model: "deepseek-v4-flash-free",
        actualModelUsed: "deepseek-v4-flash-free",
        promptVersion: "decision-ai-prompt.v2",
        policyVersion: "risk-control-policy.v1",
      },
    });
    const restartedContext = createDatabase(databaseUrl!);
    try {
      const restartedReview = await getDecisionReview(restartedContext.db, olderCase.id);
      expect(restartedReview?.rule).toEqual(persistedAvailableReview?.rule);
      expect(restartedReview?.ai).toEqual(persistedAvailableReview?.ai);
    } finally {
      await closeDatabase(restartedContext);
    }
    const history = await listDecisionHistory(context.db, { profileNo, limit: 1 });
    expect(history.items).toHaveLength(1);
    expect(history.items[0]?.case.id).toBe(firstCase.id);
    expect(history.nextCursor).not.toBeNull();
    const nextPage = await listDecisionHistory(context.db, {
      profileNo,
      limit: 1,
      cursor: history.nextCursor!,
    });
    expect(nextPage.items[0]?.case.id).toBe(olderCase.id);
    expect(nextPage.nextCursor).toBeNull();
    const [successfulRun] = await context.db.insert(syncRuns).values({
      shopId: shop!.id,
      mode: "ORDERS",
      status: "SUCCEEDED",
      startedAt: new Date("2026-08-01T00:00:00.000Z"),
      finishedAt: new Date("2026-08-01T00:01:00.000Z"),
    }).returning();
    await context.db.insert(syncRuns).values(Array.from({ length: 101 }, (_, index) => ({
      shopId: shop!.id,
      mode: "ORDERS" as const,
      status: "FAILED" as const,
      startedAt: new Date(Date.UTC(2026, 7, 2, 0, index)),
      finishedAt: new Date(Date.UTC(2026, 7, 2, 0, index, 30)),
      failureType: "TEST_FAILURE",
      failureMessage: "Synthetic integration failure",
    })));
    await expect(findLatestSuccessfulSyncRun(context.db, shop!.id)).resolves.toMatchObject({
      id: successfulRun!.id,
      status: "SUCCEEDED",
    });
    await expect(context.db.update(shops).set({
      dataOrigin: "DEMO_SANITIZED",
      enabled: false,
      syncState: "DISABLED",
    }).where(eq(shops.id, shop!.id))).rejects.toThrow();
  });

  it("keeps sanitized DEMO cases out of default LIVE history", async () => {
    await expect(context.db.insert(shops).values({
      profileId: `bad-${demoProfileNo}`,
      profileNo: `bad-${demoProfileNo}`,
      displayName: "Invalid Demo Shop",
      region: "US",
      locale: "en-US",
      dataOrigin: "DEMO_SANITIZED",
      enabled: true,
      syncState: "ACTIVE",
    })).rejects.toThrow();
    const [shop] = await context.db.insert(shops).values({
      profileId: demoProfileNo,
      profileNo: demoProfileNo,
      displayName: "Sanitized Demo Shop",
      region: "US",
      locale: "en-US",
      currency: "USD",
      dataOrigin: "DEMO_SANITIZED",
      enabled: false,
      syncState: "DISABLED",
    }).returning();
    await expect(context.db.update(shops).set({
      dataOrigin: "LIVE",
      enabled: true,
      syncState: "ACTIVE",
    }).where(eq(shops.id, shop!.id))).rejects.toThrow();

    const created = await createDecisionCase(context.db, {
      requestId: randomUUID(),
      caseOrigin: "DEMO_SANITIZED",
      shopId: shop!.id,
      observedAt: new Date("2026-08-14T01:00:00.000Z"),
      metricsSnapshot: {
        window: "FULL_PERSISTED_HISTORY",
        periodStart: "2026-08-01T00:00:00.000Z",
        periodEnd: "2026-08-14T01:00:00.000Z",
        totalOrders: 0,
        onHoldOrderCount: null,
        deliveredCount: null,
        deliveryRate: null,
        cancellationRate: null,
        refundRate: null,
        onHoldValue: null,
        currency: "USD",
      },
      riskSnapshot: {
        policyVersion: "risk-control-policy.v1",
        evaluatedAt: "2026-08-14T01:00:00.000Z",
        onHoldValue: null,
        deliveryRate: null,
        stopByOnHoldValue: false,
        stopByDeliveryRate: false,
        dataSufficient: false,
        stopOnHoldValueAt: "3500.0000",
        stopDeliveryRateBelow: 0.7,
        minimumOrdersForRateRule: 0,
      },
      financeSnapshot: {
        capturedAt: null,
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
        coverageState: "UNKNOWN",
        persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
        provenSourceWindow: null,
        completeWithinSourceWindow: null,
        lifetimeHistoryComplete: null,
      },
      ruleDecision: "INSUFFICIENT_DATA",
      ruleTriggers: [],
      dataCoverage: "UNKNOWN",
      sourceSyncRunId: null,
    });

    await expect(listDecisionHistory(context.db, { profileNo: demoProfileNo }))
      .resolves.toEqual({ items: [], nextCursor: null });
    const demoHistory = await listDecisionHistory(context.db, {
      profileNo: demoProfileNo,
      caseOrigin: "DEMO_SANITIZED",
    });
    expect(demoHistory.items[0]?.case).toMatchObject({
      id: created.id,
      origin: "DEMO_SANITIZED",
    });
  });
});
