import { describe, expect, test } from "vitest";
import type { BaselineAiInput } from "@shop-health/decision-ai";

import {
  createDecisionWorkflow,
  DecisionWorkflowError,
  type DecisionWorkflowStore,
  type PersistedDecisionReview,
  type ReviewStartSource,
} from "./index.js";

const caseId = "0df4a641-4555-4f4d-bb32-595f95ad3c7c";
const shopId = "d91ef278-d9f0-4322-aaf9-f9683d6143e4";
const now = new Date("2026-08-14T08:30:00.000Z");

const source: ReviewStartSource = {
  shop: {
    id: shopId,
    profileNo: "DEMO-001",
    displayName: "Sanitized Demo Shop",
    currency: "USD",
    dataOrigin: "DEMO_SANITIZED",
    dataCoverage: "UNKNOWN",
    lastSyncAt: null,
  },
  periodStart: new Date("2026-08-01T00:00:00.000Z"),
  periodEnd: new Date("2026-08-14T00:00:00.000Z"),
  facts: [
    {
      canonicalStatus: "AWAITING_SHIPMENT",
      currency: "USD",
      orderCount: 2,
      totalValue: "3600.0000",
      lastObservedAt: new Date("2026-08-13T12:00:00.000Z"),
    },
    {
      canonicalStatus: "DELIVERED",
      currency: "USD",
      orderCount: 8,
      totalValue: "800.0000",
      lastObservedAt: new Date("2026-08-13T13:00:00.000Z"),
    },
  ],
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
  sourceSyncRunId: null,
  holidayModeCurrentlyEnabled: null,
  consecutiveSafeCycles: 0,
};

const persistedAiInput: BaselineAiInput = {
  metricsSnapshot: {
    window: "FULL_PERSISTED_HISTORY",
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-08-14T00:00:00.000Z",
    totalOrders: 10,
    onHoldOrderCount: 10,
    deliveredCount: 8,
    deliveryRate: 0.8,
    cancellationRate: null,
    refundRate: null,
    onHoldValue: "4400.0000",
    currency: "USD",
  },
  financeSnapshot: source.financeSnapshot,
  coverageSnapshot: {
    coverageState: "UNKNOWN",
    persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
    provenSourceWindow: null,
    completeWithinSourceWindow: null,
    lifetimeHistoryComplete: null,
  },
  riskSnapshot: {
    policyVersion: "risk-control-policy.v1",
    evaluatedAt: now.toISOString(),
    onHoldValue: "4400.0000",
    deliveryRate: 0.8,
    stopByOnHoldValue: true,
    stopByDeliveryRate: false,
    dataSufficient: true,
    stopOnHoldValueAt: "3500.0000",
    stopDeliveryRateBelow: 0.7,
    minimumOrdersForRateRule: 0,
  },
  ruleDecision: "PAUSE",
  ruleTriggers: ["ONHOLD_VALUE"],
};

const unavailableResult = {
  status: "UNAVAILABLE" as const,
  errorCode: "CONFIG_MISSING" as const,
  humanReviewRequired: true as const,
  provider: "9router" as const,
  requestedModel: "oc/deepseek-v4-flash-free",
  reportedModel: null,
  actualModelUsed: null,
  authMode: "CONFIG_MISSING" as const,
  outputSchemaVersion: "decision-ai-output.v1" as const,
  promptVersion: "decision-ai-prompt.v2" as const,
  aiPolicyVersion: "decision-ai-policy.v1" as const,
  rulePolicyVersion: "risk-control-policy.v1",
  generatedAt: now.toISOString(),
};

function review(overrides: Partial<PersistedDecisionReview> = {}): PersistedDecisionReview {
  return {
    case: { id: caseId, origin: "DEMO_SANITIZED", observedAt: now, createdAt: now },
    shop: source.shop,
    coverageSnapshot: {
      coverageState: "UNKNOWN",
      persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
      provenSourceWindow: null,
      completeWithinSourceWindow: null,
      lifetimeHistoryComplete: null,
    },
    metrics: {
      totalOrders: 10,
      onHoldValue: "4400.0000",
      deliveredCount: 8,
      deliveryRate: 0.8,
      cancellationRate: null,
      refundRate: null,
      currency: "USD",
      unavailableReasons: {
        onHoldValue: "NOT_AVAILABLE",
        deliveredCount: "NOT_AVAILABLE",
        deliveryRate: "NOT_AVAILABLE",
        cancellationRate: "NOT_CAPTURED",
        refundRate: "NOT_CAPTURED",
      },
    },
    rule: {
      decision: "PAUSE",
      triggers: ["ONHOLD_VALUE"],
      expression: "VALUE >= 3500 USD OR DELIVERY_RATE < 70%",
      policyVersion: "risk-control-policy.v1",
      thresholds: {
        stopOnHoldValueAt: "3500.0000",
        stopDeliveryRateBelow: 0.7,
        minimumOrdersForRateRule: 0,
      },
    },
    ai: null,
    ba: null,
    execution: null,
    events: [{ type: "CASE_STARTED", occurredAt: now }],
    ...overrides,
  };
}

function createStore(): DecisionWorkflowStore & {
  created: unknown[];
  aiRecords: unknown[];
  baRecords: unknown[];
  executionRecords: unknown[];
} {
  const state = { current: review() };
  return {
    created: [],
    aiRecords: [],
    baRecords: [],
    executionRecords: [],
    async getDecisionReviewByRequestId() {
      return null;
    },
    async loadReviewStartSource(profileNo) {
      expect(profileNo).toBe("DEMO-001");
      return source;
    },
    async getDecisionAiInput() {
      return persistedAiInput;
    },
    async createDecisionCase(input) {
      this.created.push(input);
      return { caseId };
    },
    async recordAiDecision(input) {
      this.aiRecords.push(input);
      state.current = review({
        ai: input.result.status === "AVAILABLE"
          ? {
              status: "AVAILABLE",
              recommendation: input.result.recommendation,
              riskLevel: input.result.riskLevel,
              confidence: input.result.confidence,
              ruleOverride: input.result.ruleOverride,
              reasonCodes: input.result.reasonCodes,
              supportingFactors: input.result.supportingFactors,
              riskFactors: input.result.riskFactors,
              whatWouldChangeDecision: input.result.whatWouldChangeDecision,
              reason: input.result.reason,
              humanReviewRequired: input.result.humanReviewRequired,
              provider: input.result.provider,
              model: input.result.actualModelUsed,
              requestedModel: input.result.requestedModel,
              reportedModel: input.result.reportedModel,
              actualModelUsed: input.result.actualModelUsed,
              authMode: input.result.authMode,
              outputSchemaVersion: "decision-ai-output.v1",
              promptVersion: input.result.promptVersion,
              policyVersion: input.result.rulePolicyVersion,
              aiPolicyVersion: input.result.aiPolicyVersion,
              createdAt: now,
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
              failureCode: input.result.errorCode,
              humanReviewRequired: true,
              provider: input.result.provider,
              model: null,
              requestedModel: input.result.requestedModel,
              reportedModel: input.result.reportedModel,
              actualModelUsed: input.result.actualModelUsed,
              authMode: input.result.authMode,
              outputSchemaVersion: "decision-ai-output.v1",
              promptVersion: input.result.promptVersion,
              policyVersion: input.result.rulePolicyVersion,
              aiPolicyVersion: input.result.aiPolicyVersion,
              createdAt: now,
            },
      });
    },
    async recordBaDecision(input) {
      this.baRecords.push(input);
      state.current = review({
        ba: {
          id: "5f064f5d-b782-4440-9267-8ab2f014a7fe",
          decision: input.decision,
          confidence: input.confidence ?? null,
          reasonCodes: input.reasonCodes,
          note: input.note ?? null,
          decidedAt: now,
        },
      });
    },
    async recordDryRunExecution(input) {
      this.executionRecords.push(input);
    },
    async getDecisionReview() {
      return state.current;
    },
    async listDecisionHistory() {
      return { items: [state.current], nextCursor: null };
    },
  };
}

describe("decision workflow", () => {
  test("persists verified source coverage instead of inferring lifetime history", async () => {
    const store = createStore();
    store.loadReviewStartSource = async () => ({
      ...source,
      shop: { ...source.shop, dataCoverage: "COMPLETE" },
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
    });
    const workflow = createDecisionWorkflow({
      store,
      aiClient: { recommend: async () => unavailableResult },
      now: () => now,
    });

    await workflow.startReview({ profileNo: "DEMO-001" });

    expect(store.created[0]).toMatchObject({
      decisionCase: {
        coverageSnapshot: {
          provenSourceWindow: "ROLLING_12_MONTHS",
          completeWithinSourceWindow: true,
          lifetimeHistoryComplete: false,
          freshness: "FRESH",
        },
        metricsSnapshot: {
          totalPersistedOrders: 10,
          operationalOrderCount: 10,
        },
      },
    });
  });

  test("starts an immutable case from persisted facts and stores a separate AI result", async () => {
    const store = createStore();
    let receivedAiInput: unknown;
    const workflow = createDecisionWorkflow({
      store,
      aiClient: {
        async recommend(input) {
          receivedAiInput = input;
          return unavailableResult;
        },
      },
      now: () => now,
    });

    const result = await workflow.startReview({
      profileNo: "DEMO-001",
      requestId: "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
    });

    expect(result.schemaVersion).toBe("decision-review.v1");
    expect(store.created).toHaveLength(1);
    expect(store.created[0]).toMatchObject({
      requestId: "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
      caseOrigin: "DEMO_SANITIZED",
      decisionCase: {
        shopId,
        observedAt: now,
        ruleDecision: "PAUSE",
        ruleTriggers: ["ONHOLD_VALUE"],
        dataCoverage: "UNKNOWN",
        sourceSyncRunId: null,
        metricsSnapshot: {
          totalOrders: 10,
          onHoldValue: "4400.0000",
          deliveredCount: 8,
          deliveryRate: 0.8,
          cancellationRate: null,
          refundRate: null,
        },
      },
    });
    expect(receivedAiInput).toBe(persistedAiInput);
    expect(store.aiRecords).toHaveLength(1);
    expect(store.aiRecords[0]).toMatchObject({
      decisionCaseId: caseId,
      requestId: "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
      result: { status: "UNAVAILABLE", errorCode: "CONFIG_MISSING" },
    });
  });

  test("AI unavailable never blocks a later BA decision", async () => {
    const store = createStore();
    const workflow = createDecisionWorkflow({
      store,
      aiClient: { recommend: async () => { throw new Error("AI should not be called"); } },
      now: () => now,
    });

    const result = await workflow.decide({
      caseId,
      decision: "WATCH",
      reasonCodes: ["DATA_INCOMPLETE"],
      note: "Needs a larger sample",
      requestId: "9f45eef4-d10f-4392-9b23-3dbefad2991c",
    });

    expect(store.baRecords).toHaveLength(1);
    expect(result.ba).toMatchObject({ status: "DECIDED", decision: "WATCH" });
  });

  test("requires explicit confirmation and a PAUSE BA decision for DRY_RUN execution", async () => {
    const store = createStore();
    const workflow = createDecisionWorkflow({
      store,
      aiClient: { recommend: async () => { throw new Error("AI should not be called"); } },
      now: () => now,
    });

    await expect(workflow.execute({ caseId, confirm: false })).rejects.toEqual(
      expect.objectContaining<Partial<DecisionWorkflowError>>({ code: "CONFIRMATION_REQUIRED" }),
    );
    expect(store.executionRecords).toHaveLength(0);

    await workflow.decide({
      caseId,
      decision: "WATCH",
      reasonCodes: ["DATA_INCOMPLETE"],
    });
    await expect(workflow.execute({ caseId, confirm: true })).rejects.toEqual(
      expect.objectContaining<Partial<DecisionWorkflowError>>({ code: "PAUSE_DECISION_REQUIRED" }),
    );
    expect(store.executionRecords).toHaveLength(0);

    await workflow.decide({
      caseId,
      decision: "PAUSE",
      reasonCodes: ["HIGH_ABSOLUTE_EXPOSURE"],
    });
    await workflow.execute({
      caseId,
      confirm: true,
      requestId: "9f45eef4-d10f-4392-9b23-3dbefad2991c",
    });
    expect(store.executionRecords).toEqual([
      {
        decisionCaseId: caseId,
        baDecisionId: expect.any(String),
        requestId: "9f45eef4-d10f-4392-9b23-3dbefad2991c",
      },
    ]);
  });

  test("generates one request ID per mutation when the CLI omits it", async () => {
    const store = createStore();
    const generated = [
      "1ad7f982-aa2d-447f-896b-1379df685ca0",
      "40fc2542-42dc-467b-a2d8-a96191b42d17",
    ];
    const workflow = createDecisionWorkflow({
      store,
      aiClient: {
        recommend: async () => unavailableResult,
      },
      now: () => now,
      randomUuid: () => generated.shift()!,
    });

    await workflow.startReview({ profileNo: "DEMO-001" });
    await workflow.decide({
      caseId,
      decision: "WATCH",
      reasonCodes: ["DATA_INCOMPLETE"],
    });

    expect(store.created[0]).toMatchObject({ requestId: "1ad7f982-aa2d-447f-896b-1379df685ca0" });
    expect(store.aiRecords[0]).toMatchObject({ requestId: "1ad7f982-aa2d-447f-896b-1379df685ca0" });
    expect(store.baRecords[0]).toMatchObject({ requestId: "40fc2542-42dc-467b-a2d8-a96191b42d17" });
  });

  test("returns a completed immutable case before reloading facts on a request retry", async () => {
    const store = createStore();
    store.getDecisionReviewByRequestId = async () => review({
      ai: {
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
        failureCode: "CONFIG_MISSING",
        humanReviewRequired: true,
        provider: "9router",
        model: null,
        requestedModel: "oc/deepseek-v4-flash-free",
        reportedModel: null,
        actualModelUsed: null,
        authMode: "CONFIG_MISSING",
        outputSchemaVersion: "decision-ai-output.v1",
        promptVersion: "decision-ai-prompt.v2",
        policyVersion: "risk-control-policy.v1",
        aiPolicyVersion: "decision-ai-policy.v1",
        createdAt: now,
      },
    });
    store.loadReviewStartSource = async () => {
      throw new Error("persisted facts must not be reloaded for a request retry");
    };
    const workflow = createDecisionWorkflow({
      store,
      aiClient: { recommend: async () => { throw new Error("AI must not be called for a completed retry"); } },
      now: () => now,
    });

    const result = await workflow.startReview({
      profileNo: "DEMO-001",
      requestId: "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
    });

    expect(result.case.id).toBe(caseId);
    expect(store.created).toHaveLength(0);
    expect(store.aiRecords).toHaveLength(0);
  });

  test("resumes AI from the exact persisted snapshot when a retry finds an incomplete case", async () => {
    const store = createStore();
    store.getDecisionReviewByRequestId = async () => review({ ai: null });
    store.loadReviewStartSource = async () => {
      throw new Error("persisted facts must not be reloaded for an incomplete retry");
    };
    let receivedAiInput: BaselineAiInput | undefined;
    const workflow = createDecisionWorkflow({
      store,
      aiClient: {
        recommend: async (input) => {
          receivedAiInput = input;
          return unavailableResult;
        },
      },
      now: () => now,
    });

    const result = await workflow.startReview({
      profileNo: "DEMO-001",
      requestId: "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
    });

    expect(receivedAiInput).toBe(persistedAiInput);
    expect(store.created).toHaveLength(0);
    expect(store.aiRecords).toHaveLength(1);
    expect(result.ai).toMatchObject({ status: "UNAVAILABLE", failureCode: "CONFIG_MISSING" });
  });

  test("concurrent starts keep AI records associated with the one persisted case", async () => {
    const store = createStore();
    let calls = 0;
    let release: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve) => { release = resolve; });
    const workflow = createDecisionWorkflow({
      store,
      aiClient: {
        recommend: async () => {
          calls += 1;
          if (calls === 2) release?.();
          else await bothStarted;
          return unavailableResult;
        },
      },
      now: () => now,
    });
    const input = {
      profileNo: "DEMO-001",
      requestId: "8d0c6464-1976-4a2f-84fb-25e2cd6efea5",
    } as const;

    const [left, right] = await Promise.all([
      workflow.startReview(input),
      workflow.startReview(input),
    ]);

    expect(left.case.id).toBe(caseId);
    expect(right.case.id).toBe(caseId);
    expect(left.ai).toMatchObject({ status: "UNAVAILABLE", failureCode: "CONFIG_MISSING" });
    expect(right.ai).toMatchObject({ status: "UNAVAILABLE", failureCode: "CONFIG_MISSING" });
    expect(store.aiRecords).toHaveLength(2);
    expect(store.aiRecords).toEqual(store.aiRecords.map((record) => expect.objectContaining({
      requestId: input.requestId,
      decisionCaseId: caseId,
    })));
  });

  test("uses a production UUID generator when no request ID dependency is injected", async () => {
    const store = createStore();
    const workflow = createDecisionWorkflow({
      store,
      aiClient: {
        recommend: async () => unavailableResult,
      },
      now: () => now,
    });

    await workflow.startReview({ profileNo: "DEMO-001" });

    expect(store.created[0]).toMatchObject({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });
});
