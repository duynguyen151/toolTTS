import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

process.env.TOOL_BA_ACTOR = "test-ba";

import type { Database } from "../client.js";
import type { AiDecisionContext } from "@shop-health/domain";
import { baDecisions, decisionCases, shops } from "../schema.js";
import {
  captureBaDecision,
  createDecisionCase,
  getDecisionAiInput,
  getDecisionReview,
  getLatestDecisionContext,
  recordAiDecision,
  recordBaDecisionForCase,
  recordDryRunExecution,
  type CaptureBaDecisionInput,
} from "../index.js";

const decisionContextSnapshot = {
  schemaVersion: "ai-decision-context.v1" as const,
  profile: { profileId: "profile-1", profileNo: "1" },
  shop: {
    shopId: "00000000-0000-4000-8000-000000000001",
    tiktokShopId: null,
    displayName: null,
    region: "US" as const,
    locale: "en-US" as const,
    currency: "USD" as const,
  },
  metrics: {
    observedAt: "2026-08-14T00:00:00.000Z",
    decision: {
      window: "FULL_PERSISTED_HISTORY",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-14T00:00:00.000Z",
      totalOrders: 120,
      totalPersistedOrders: 120,
      operationalOrderCount: 120,
      onHoldOrderCount: 18,
      deliveredCount: 84,
      deliveryRate: 0.84,
      cancellationRate: 0.05,
      refundRate: 0.02,
      operationalExposure: "1200.0000",
      currency: "USD" as const,
    },
    finance: {
      capturedAt: "2026-08-14T00:00:00.000Z",
      currency: "USD" as const,
      availableBalance: "2400.0000",
      frozenBalance: "100.0000",
      totalBalance: "2500.0000",
      toSettleBalance: "800.0000",
      officialFinanceOnHold: "1200.0000",
      waitingForCompletedRefundReturnAmount: "200.0000",
      settlementCount: 40,
      onHoldSettlementCount: 6,
    },
  },
  comparisons: [],
  trends: [
    "RAPID_ONHOLD_GROWTH",
    "DELIVERY_DETERIORATION",
    "REFUND_SPIKE",
    "RECOVERY_TREND",
    "THRESHOLD_FLAPPING",
  ].map((signal) => ({
    signal: signal as "RAPID_ONHOLD_GROWTH" | "DELIVERY_DETERIORATION" | "REFUND_SPIKE" | "RECOVERY_TREND" | "THRESHOLD_FLAPPING",
    comparisons: [],
    status: "NOT_EVALUATED" as const,
    reasonCode: "POLICY_UNCONFIGURED" as const,
  })),
  dataQuality: {
    coverage: "COMPLETE" as const,
    source: null,
    provenSourceWindow: null,
    completeWithinSourceWindow: null,
    lifetimeHistoryComplete: null,
    ordersSourceComplete: null,
    financeRequiredSourceComplete: null,
    sourceReconciled: null,
    freshness: "UNKNOWN" as const,
    latestSuccessfulSyncAt: null,
    financeCapturedAt: null,
    blockers: [
      "SOURCE_NOT_VERIFIED",
      "ORDERS_SOURCE_INCOMPLETE",
      "FINANCE_SOURCE_INCOMPLETE",
      "FINANCE_NOT_RECONCILED",
      "FRESHNESS_UNKNOWN",
    ],
  },
  risk: {
    policyVersion: "risk-control-policy.v1",
    evaluatedAt: "2026-08-14T00:00:00.000Z",
    operationalExposure: "1200.0000",
    deliveryRate: 0.84,
    stopByOnHoldValue: false,
    stopByDeliveryRate: false,
    dataSufficient: true,
    stopOnHoldValueAt: "3500.0000",
    stopDeliveryRateBelow: 0.7,
    minimumOrdersForRateRule: 0,
  },
  rule: {
    result: "CONTINUE" as const,
    policyVersion: "risk-control-policy.v1",
    checks: [
      { metric: "operationalExposure", observedValue: "1200.0000", threshold: "3500.0000", operator: "GTE" as const, result: "PASS" as const, triggeredReason: null },
      { metric: "deliveryRate", observedValue: 0.84, threshold: 0.7, operator: "LT" as const, result: "PASS" as const, triggeredReason: null },
    ],
    triggers: [],
    expression: "operationalExposure >= 3500 USD OR deliveryRate < 70%",
    evaluatedAt: "2026-08-14T00:00:00.000Z",
  },
  previousCompatibleSnapshot: null,
  policyVersions: {
    metricDefinitionVersion: "decision-metrics.v1",
    riskPolicyVersion: "risk-control-policy.v1",
    trendPolicyVersion: null,
  },
};

const input: CaptureBaDecisionInput = {
  decisionCase: {
    shopId: "00000000-0000-4000-8000-000000000001",
    observedAt: new Date("2026-08-14T00:00:00.000Z"),
    metricsSnapshot: {
      window: "FULL_PERSISTED_HISTORY",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-14T00:00:00.000Z",
      totalOrders: 120,
      totalPersistedOrders: 120,
      operationalOrderCount: 120,
      onHoldOrderCount: 18,
      deliveredCount: 84,
      deliveryRate: 0.84,
      cancellationRate: 0.05,
      refundRate: 0.02,
      onHoldValue: "1200.0000",
      currency: "USD",
    },
    riskSnapshot: {
      policyVersion: "risk-control-policy.v1",
      evaluatedAt: "2026-08-14T00:00:00.000Z",
      onHoldValue: "1200.0000",
      deliveryRate: 0.84,
      stopByOnHoldValue: false,
      stopByDeliveryRate: false,
      dataSufficient: true,
      stopOnHoldValueAt: "3500.0000",
      stopDeliveryRateBelow: 0.7,
      minimumOrdersForRateRule: 0,
    },
    financeSnapshot: {
      capturedAt: "2026-08-14T00:00:00.000Z",
      currency: "USD",
      availableBalance: "2400.0000",
      frozenBalance: "100.0000",
      totalBalance: "2500.0000",
      toSettleBalance: "800.0000",
      onHoldBalance: "1200.0000",
      officialOnHoldAmount: "1200.0000",
      waitingForCompletedRefundReturnAmount: "200.0000",
      settlementCount: 40,
      onHoldSettlementCount: 6,
    },
    coverageSnapshot: {
      coverageState: "COMPLETE",
      persistedMetricsWindow: "FULL_PERSISTED_HISTORY",
      provenSourceWindow: null,
      completeWithinSourceWindow: null,
      lifetimeHistoryComplete: null,
    },
    ruleDecision: "CONTINUE",
    ruleTriggers: [],
    dataCoverage: "COMPLETE",
    sourceSyncRunId: null,
    decisionContextSnapshot,
  },
  baDecision: {
    decision: "WATCH",
    reasonCode: "HIGH_ABSOLUTE_EXPOSURE",
    confidence: 0.75,
    reasonCodes: ["HIGH_ABSOLUTE_EXPOSURE"],
    note: "Monitor settlement",
  },
};

function decisionReviewDb(stopDeliveryRateBelow: number): Database {
  const decisionCase = {
    ...input.decisionCase,
    riskSnapshot: { ...input.decisionCase.riskSnapshot, stopDeliveryRateBelow },
    decisionContextSnapshot: null,
    caseOrigin: "LIVE" as const,
    createdAt: new Date("2026-08-14T00:01:00.000Z"),
  };
  const shop = {
    id: decisionCase.shopId,
    profileId: "profile-1",
    profileNo: "1",
    displayName: "Test Shop",
    currency: "USD",
    dataOrigin: "LIVE" as const,
    lastOrdersSyncedAt: null,
    lastFinanceSyncedAt: null,
  };
  const baseQuery = {
    from() {
      return {
        innerJoin() {
          return {
            where() {
              return { async limit() { return [{ decisionCase, shop }]; } };
            },
          };
        },
      };
    },
  };
  const emptyQuery = {
    from() {
      return {
        where() {
          return {
            orderBy() {
              return { async limit() { return []; } };
            },
            async limit() { return []; },
          };
        },
      };
    },
  };
  return {
    select(selection?: unknown) {
      if (selection !== undefined) return baseQuery;
      return emptyQuery;
    },
  } as unknown as Database;
}

function transactionDouble(options?: {
  failBaInsert?: boolean;
  owner?: { profileId: string; profileNo: string };
}): {
  db: Database;
  transactionEntered: () => boolean;
  inserted: Array<{ table: unknown; values: unknown }>;
} {
  let entered = false;
  const inserted: Array<{ table: unknown; values: unknown }> = [];
  const decisionCaseRow = {
    id: "00000000-0000-4000-8000-000000000010",
    ...input.decisionCase,
    createdAt: new Date("2026-08-14T00:01:00.000Z"),
  };
  const baDecisionRow = {
    id: "00000000-0000-4000-8000-000000000011",
    decisionCaseId: decisionCaseRow.id,
    decision: "WATCH" as const,
    confidence: "0.75",
    reasonCodes: ["HIGH_ABSOLUTE_EXPOSURE"] as const,
    note: "Monitor settlement",
    createdAt: new Date("2026-08-14T00:01:01.000Z"),
  };
  const transaction = {
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              return {
                async limit() {
                  return table === shops
                    ? [options?.owner ?? { profileId: "profile-1", profileNo: "1" }]
                    : [];
                },
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: unknown) {
          inserted.push({ table, values });
          return {
            async returning() {
              if (table === baDecisions && options?.failBaInsert === true) {
                throw new Error("BA insert failed");
              }
              return table === decisionCases ? [decisionCaseRow] : [baDecisionRow];
            },
          };
        },
      };
    },
  };
  const db = {
    async transaction<T>(callback: (tx: typeof transaction) => Promise<T>): Promise<T> {
      entered = true;
      return callback(transaction);
    },
  } as unknown as Database;

  return { db, transactionEntered: () => entered, inserted };
}

describe("captureBaDecision", () => {
  it("rejects invalid input before opening a transaction", async () => {
    const double = transactionDouble();

    await expect(
      captureBaDecision(double.db, {
        ...input,
        baDecision: { ...input.baDecision, confidence: 1.1 },
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(double.transactionEntered()).toBe(false);
  });

  it("inserts and returns the linked case and BA decision in one transaction", async () => {
    const double = transactionDouble();

    const result = await captureBaDecision(double.db, input);

    expect(double.transactionEntered()).toBe(true);
    expect(double.inserted).toHaveLength(2);
    expect(double.inserted[0]).toEqual({ table: decisionCases, values: input.decisionCase });
    expect(double.inserted[1]).toEqual({
      table: baDecisions,
      values: {
        decisionCaseId: "00000000-0000-4000-8000-000000000010",
        decision: "WATCH",
        reasonCode: "HIGH_ABSOLUTE_EXPOSURE",
        confidence: "0.75",
        reasonCodes: ["HIGH_ABSOLUTE_EXPOSURE"],
        plannedMethods: null,
        note: "Monitor settlement",
        notes: "Monitor settlement",
        actor: "test-ba",
      },
    });
    expect(result.decisionCase.id).toBe("00000000-0000-4000-8000-000000000010");
    expect(result.baDecision.decisionCaseId).toBe(result.decisionCase.id);
  });

  it("rejects a BA insert failure from inside the transaction", async () => {
    const double = transactionDouble({ failBaInsert: true });

    await expect(captureBaDecision(double.db, input)).rejects.toThrow("BA insert failed");
    expect(double.transactionEntered()).toBe(true);
    expect(double.inserted).toHaveLength(2);
  });

  it("rejects a frozen context whose profile does not belong to the transaction owner shop", async () => {
    const double = transactionDouble({ owner: { profileId: "profile-2", profileNo: "2" } });

    await expect(captureBaDecision(double.db, input)).rejects.toThrow(
      "Decision intelligence inputs are inconsistent: context profile id is not owned by the decision case; context profile number is not owned by the decision case",
    );
    expect(double.inserted).toHaveLength(0);
  });
});

describe("decision workflow persistence boundaries", () => {
  const rejectingDb = new Proxy(
    {},
    {
      get() {
        throw new Error("Database must not be touched for invalid input");
      },
    },
  ) as Database;

  it("validates case creation before touching the database", async () => {
    await expect(
      createDecisionCase(rejectingDb, {
        ...input.decisionCase,
        requestId: "not-a-uuid",
        caseOrigin: "LIVE",
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("persists target-Rule context when Official On Hold differs from Operational Exposure", async () => {
    const targetRuleEvidence = {
      schemaVersion: "official-on-hold-rule.v1" as const,
      policyVersion: "risk-control-policy.v1",
      evaluatedAt: "2026-08-14T00:00:00.000Z",
      decision: "PAUSE" as const,
      triggers: ["OFFICIAL_ON_HOLD" as const],
      expression: "officialFinanceOnHold >= 3500 USD OR deliveryRate < 70%",
      officialOnHold: {
        state: "TRIGGERED" as const,
        source: "SELLER_CENTER" as const,
        observedValue: "5000.0000",
        observedAt: "2026-08-14T00:00:00.000Z",
        ageMs: 0,
        quality: "FRESH" as const,
        completeness: "COMPLETE" as const,
        reconciliation: "RECONCILED" as const,
        refreshState: "SUCCEEDED" as const,
        threshold: "3500.0000",
      },
      deliveryRate: {
        state: "CLEAR" as const,
        source: "SELLER_CENTER" as const,
        observedValue: 0.84,
        observedAt: "2026-08-14T00:00:00.000Z",
        ageMs: 0,
        quality: "FRESH" as const,
        deliveredCount: 84,
        totalCount: 100,
        threshold: 0.7,
        unavailableReasons: [],
      },
    };
    const baseContext = input.decisionCase.decisionContextSnapshot as unknown as AiDecisionContext;
    const decisionContextSnapshot = {
      ...baseContext,
      targetRuleEvidence,
      metrics: {
        ...baseContext.metrics,
        finance: {
          ...baseContext.metrics.finance,
          officialFinanceOnHold: "5000.0000",
        },
      },
      risk: {
        ...baseContext.risk,
      },
      rule: {
        ...baseContext.rule,
        result: "PAUSE" as const,
        triggers: ["OFFICIAL_ON_HOLD" as const],
        expression: targetRuleEvidence.expression,
        checks: [
          { metric: "officialFinanceOnHold", observedValue: "5000.0000", threshold: "3500.0000", operator: "GTE" as const, result: "FAIL" as const, triggeredReason: "OFFICIAL_ON_HOLD_LIMIT_REACHED" as const },
          { metric: "deliveryRate", observedValue: 0.84, threshold: 0.7, operator: "LT" as const, result: "PASS" as const, triggeredReason: null },
        ],
      },
    };
    const caseInput = {
      ...input.decisionCase,
      requestId: "00000000-0000-4000-8000-000000000099",
      caseOrigin: "LIVE" as const,
      financeSnapshot: { ...input.decisionCase.financeSnapshot, officialOnHoldAmount: "5000.0000" },
      riskSnapshot: {
        ...input.decisionCase.riskSnapshot,
      },
      ruleDecision: "PAUSE" as const,
      ruleTriggers: ["ONHOLD_VALUE" as const],
      decisionContextSnapshot,
    };
    const created = { id: "00000000-0000-4000-8000-000000000100", ...caseInput };
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return { async limit() { return [{ profileId: "profile-1", profileNo: "1" }]; } };
              },
            };
          },
        };
      },
      insert() {
        return {
          values() {
            return {
              onConflictDoNothing() {
                return { async returning() { return [created]; } };
              },
            };
          },
        };
      },
    } as unknown as Database;

    await expect(createDecisionCase(db, caseInput)).resolves.toMatchObject({ id: created.id });
  });

  it("keeps target-Rule context as the latest snapshot when Official On Hold differs from Operational Exposure", async () => {
    const targetRuleEvidence = {
      schemaVersion: "official-on-hold-rule.v1" as const,
      policyVersion: "risk-control-policy.v1",
      evaluatedAt: "2026-08-14T00:00:00.000Z",
      decision: "PAUSE" as const,
      triggers: ["OFFICIAL_ON_HOLD" as const],
      expression: "officialFinanceOnHold >= 3500 USD OR deliveryRate < 70%",
      officialOnHold: { state: "TRIGGERED" as const, source: "SELLER_CENTER" as const, observedValue: "5000.0000", observedAt: "2026-08-14T00:00:00.000Z", ageMs: 0, quality: "FRESH" as const, completeness: "COMPLETE" as const, reconciliation: "RECONCILED" as const, refreshState: "SUCCEEDED" as const, threshold: "3500.0000" },
      deliveryRate: { state: "CLEAR" as const, source: "SELLER_CENTER" as const, observedValue: 0.84, observedAt: "2026-08-14T00:00:00.000Z", ageMs: 0, quality: "FRESH" as const, deliveredCount: 84, totalCount: 100, threshold: 0.7, unavailableReasons: [] },
    };
    const baseContext = input.decisionCase.decisionContextSnapshot as unknown as AiDecisionContext;
    const context = {
      ...baseContext,
      targetRuleEvidence,
      metrics: { ...baseContext.metrics, finance: { ...baseContext.metrics.finance, officialFinanceOnHold: "5000.0000" } },
      risk: { ...baseContext.risk },
      rule: {
        ...baseContext.rule,
        result: "PAUSE" as const,
        triggers: ["OFFICIAL_ON_HOLD" as const],
        expression: targetRuleEvidence.expression,
        checks: [
          { metric: "officialFinanceOnHold", observedValue: "5000.0000", threshold: "3500.0000", operator: "GTE" as const, result: "FAIL" as const, triggeredReason: "OFFICIAL_ON_HOLD_LIMIT_REACHED" as const },
          { metric: "deliveryRate", observedValue: 0.84, threshold: 0.7, operator: "LT" as const, result: "PASS" as const, triggeredReason: null },
        ],
      },
    };
    const decisionCase = {
      ...input.decisionCase,
      caseOrigin: "LIVE" as const,
      financeSnapshot: { ...input.decisionCase.financeSnapshot, officialOnHoldAmount: "5000.0000" },
      riskSnapshot: { ...input.decisionCase.riskSnapshot },
      ruleDecision: "PAUSE" as const,
      ruleTriggers: ["ONHOLD_VALUE" as const],
      decisionContextSnapshot: context,
    };
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  orderBy() { return { async limit() { return [{ decisionCase }]; } }; },
                  async limit() { return [{ profileId: "profile-1", profileNo: "1" }]; },
                };
              },
            };
          },
        };
      },
    } as unknown as Database;

    await expect(getLatestDecisionContext(db, decisionCase.shopId)).resolves.toMatchObject({ targetRuleEvidence });
  });

  it("normalizes legacy AI input snapshots without weakening recorded coverage", async () => {
    const legacyCase = {
      metricsSnapshot: input.decisionCase.metricsSnapshot,
      financeSnapshot: {
        ...input.decisionCase.financeSnapshot,
        officialOnHoldAmount: undefined,
        waitingForCompletedRefundReturnAmount: undefined,
      },
      coverageSnapshot: null,
      riskSnapshot: input.decisionCase.riskSnapshot,
      ruleDecision: input.decisionCase.ruleDecision,
      ruleTriggers: input.decisionCase.ruleTriggers,
      dataCoverage: "COMPLETE" as const,
    };
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  async limit() {
                    return [legacyCase];
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as Database;

    await expect(getDecisionAiInput(db, "00000000-0000-4000-8000-000000000021"))
      .resolves.toEqual({
        metricsSnapshot: input.decisionCase.metricsSnapshot,
        financeSnapshot: {
          ...input.decisionCase.financeSnapshot,
          officialOnHoldAmount: null,
          waitingForCompletedRefundReturnAmount: null,
        },
        coverageSnapshot: {
          coverageState: "COMPLETE",
          persistedMetricsWindow: input.decisionCase.metricsSnapshot.window,
          provenSourceWindow: null,
          completeWithinSourceWindow: null,
          lifetimeHistoryComplete: null,
        },
        riskSnapshot: input.decisionCase.riskSnapshot,
        ruleDecision: input.decisionCase.ruleDecision,
        ruleTriggers: input.decisionCase.ruleTriggers,
        decisionContextSnapshot: null,
      });
  });

  it("keeps frozen target-rule evidence available to AI input readback", async () => {
    const targetRuleEvidence = {
      schemaVersion: "official-on-hold-rule.v1" as const,
      policyVersion: "risk-control-policy.v1",
      evaluatedAt: "2026-08-14T00:00:00.000Z",
      decision: "CONTINUE" as const,
      triggers: [],
      expression: "officialFinanceOnHold >= 3500 USD OR deliveryRate < 70%",
      officialOnHold: {
        state: "CLEAR" as const,
        source: "SELLER_CENTER" as const,
        observedValue: "1200.0000",
        observedAt: "2026-08-14T00:00:00.000Z",
        ageMs: 0,
        quality: "FRESH" as const,
        completeness: "COMPLETE" as const,
        reconciliation: "RECONCILED" as const,
        refreshState: "SUCCEEDED" as const,
        threshold: "3500.0000",
      },
      deliveryRate: {
        state: "CLEAR" as const,
        source: "SELLER_CENTER" as const,
        observedValue: 0.84,
        observedAt: "2026-08-14T00:00:00.000Z",
        ageMs: 0,
        quality: "FRESH" as const,
        deliveredCount: 84,
        totalCount: 100,
        threshold: 0.7,
        unavailableReasons: [],
      },
    };
    const context = {
      ...decisionContextSnapshot,
      targetRuleEvidence,
      rule: {
        ...decisionContextSnapshot.rule,
        expression: targetRuleEvidence.expression,
        triggers: [],
        checks: [
          { metric: "officialFinanceOnHold", observedValue: "1200.0000", threshold: "3500.0000", operator: "GTE" as const, result: "PASS" as const, triggeredReason: null },
          { metric: "deliveryRate", observedValue: 0.84, threshold: 0.7, operator: "LT" as const, result: "PASS" as const, triggeredReason: null },
        ],
      },
    };
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  async limit() {
                    return [{
                      shopId: input.decisionCase.shopId,
                      metricsSnapshot: input.decisionCase.metricsSnapshot,
                      financeSnapshot: input.decisionCase.financeSnapshot,
                      coverageSnapshot: input.decisionCase.coverageSnapshot,
                      riskSnapshot: input.decisionCase.riskSnapshot,
                      ruleDecision: input.decisionCase.ruleDecision,
                      ruleTriggers: input.decisionCase.ruleTriggers,
                      dataCoverage: input.decisionCase.dataCoverage,
                      decisionContextSnapshot: context,
                    }];
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as Database;

    await expect(getDecisionAiInput(db, "00000000-0000-4000-8000-000000000021"))
      .resolves.toMatchObject({
        decisionContextSnapshot: { targetRuleEvidence },
      });
  });

  it("treats a legacy frozen context with onHoldValue as unavailable on readback", async () => {
    const legacyContext = {
      ...decisionContextSnapshot,
      metrics: {
        ...decisionContextSnapshot.metrics,
        decision: {
          ...decisionContextSnapshot.metrics.decision,
          onHoldValue: "1200.0000",
        },
      },
    };
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  async limit() {
                    return [{
                      metricsSnapshot: input.decisionCase.metricsSnapshot,
                      financeSnapshot: input.decisionCase.financeSnapshot,
                      coverageSnapshot: input.decisionCase.coverageSnapshot,
                      riskSnapshot: input.decisionCase.riskSnapshot,
                      ruleDecision: input.decisionCase.ruleDecision,
                      ruleTriggers: input.decisionCase.ruleTriggers,
                      dataCoverage: input.decisionCase.dataCoverage,
                      decisionContextSnapshot: legacyContext,
                    }];
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as Database;

    await expect(getDecisionAiInput(db, "00000000-0000-4000-8000-000000000021"))
      .resolves.toMatchObject({ decisionContextSnapshot: null });
  });

  it("does not expose a legacy frozen context as the next compatible history snapshot", async () => {
    const legacyContext = {
      ...decisionContextSnapshot,
      metrics: {
        ...decisionContextSnapshot.metrics,
        decision: {
          ...decisionContextSnapshot.metrics.decision,
          onHoldValue: "1200.0000",
        },
      },
    };
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  orderBy() {
                    return {
                      async limit() {
                        return [{ decisionCase: { ...input.decisionCase, decisionContextSnapshot: legacyContext } }];
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as Database;

    await expect(getLatestDecisionContext(db, "00000000-0000-4000-8000-000000000001"))
      .resolves.toBeNull();
  });

  it("skips an invalid newest context and returns the newest older valid context", async () => {
    const legacyContext = {
      ...decisionContextSnapshot,
      metrics: {
        ...decisionContextSnapshot.metrics,
        decision: {
          ...decisionContextSnapshot.metrics.decision,
          onHoldValue: "1200.0000",
        },
      },
    };
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  orderBy() {
                    return {
                      async limit() {
                        return [
                          { decisionCase: { ...input.decisionCase, decisionContextSnapshot: legacyContext } },
                          { decisionCase: { ...input.decisionCase, decisionContextSnapshot } },
                        ];
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as Database;

    await expect(getLatestDecisionContext(db, "00000000-0000-4000-8000-000000000001"))
      .resolves.toEqual(decisionContextSnapshot);
  });

  it("skips a self-consistent context forged away from the persisted case facts", async () => {
    const forgedContext = {
      ...decisionContextSnapshot,
      metrics: {
        ...decisionContextSnapshot.metrics,
        decision: {
          ...decisionContextSnapshot.metrics.decision,
          operationalExposure: "9999.0000",
        },
      },
      risk: {
        ...decisionContextSnapshot.risk,
        operationalExposure: "9999.0000",
        stopByOnHoldValue: true,
      },
      rule: {
        ...decisionContextSnapshot.rule,
        result: "PAUSE" as const,
        checks: [
          { metric: "operationalExposure" as const, observedValue: "9999.0000", threshold: "3500.0000", operator: "GTE" as const, result: "FAIL" as const, triggeredReason: "OPERATIONAL_EXPOSURE_LIMIT_REACHED" as const },
          decisionContextSnapshot.rule.checks[1]!,
        ],
        triggers: ["OPERATIONAL_EXPOSURE" as const],
      },
    };
    const persistedCase = {
      ...input.decisionCase,
      decisionContextSnapshot: forgedContext,
    };
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  orderBy() {
                    return {
                      async limit() {
                        return [{ context: forgedContext, decisionCase: persistedCase, shopId: persistedCase.shopId }];
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as Database;

    await expect(getLatestDecisionContext(db, persistedCase.shopId))
      .resolves.toBeNull();
  });

  it("demotes an AVAILABLE AI result when its persisted context is invalid", async () => {
    const legacyContext = {
      ...decisionContextSnapshot,
      metrics: {
        ...decisionContextSnapshot.metrics,
        decision: {
          ...decisionContextSnapshot.metrics.decision,
          onHoldValue: "1200.0000",
        },
      },
    };
    const aiRow = {
      status: "AVAILABLE",
      recommendation: "CONTINUE",
      riskLevel: "LOW",
      confidence: "0.9",
      ruleOverride: false,
      reasonCodes: ["HIGH_VOLUME_HEALTHY"],
      supportingFactors: [],
      riskFactors: [],
      whatWouldChangeDecision: [],
      reason: "Healthy",
      humanReviewRequired: false,
      provider: "9router",
      model: "model",
      requestedModel: "model",
      reportedModel: "model",
      actualModelUsed: "model",
      authMode: "LOCAL_NO_AUTH",
      outputSchemaVersion: "decision-ai-output.v1",
      promptVersion: "decision-ai-prompt.v2",
      policyVersion: "risk-control-policy.v1",
      aiPolicyVersion: "decision-ai-policy.v1",
      createdAt: new Date("2026-08-14T00:02:00.000Z"),
    };
    let selectCount = 0;
    const db = {
      select(selection?: unknown) {
        const current = selectCount++;
        if (current === 0 && selection !== undefined) {
          return {
            from() {
              return {
                innerJoin() {
                  return {
                    where() {
                      return { async limit() {
                        return [{
                          decisionCase: {
                            id: "00000000-0000-4000-8000-000000000021",
                            ...input.decisionCase,
                            riskSnapshot: { ...input.decisionCase.riskSnapshot, stopDeliveryRateBelow: 0.58 },
                            caseOrigin: "LIVE",
                            createdAt: new Date("2026-08-14T00:01:00.000Z"),
                            decisionContextSnapshot: legacyContext,
                          },
                          shop: {
                            id: input.decisionCase.shopId,
                            profileNo: "1",
                            displayName: "Test Shop",
                            currency: "USD",
                            dataOrigin: "LIVE",
                            lastOrdersSyncedAt: null,
                            lastFinanceSyncedAt: null,
                          },
                        }];
                      } };
                    },
                  };
                },
              };
            },
          };
        }
        if (current === 1) {
          return {
            from() {
              return {
                where() {
                  return { async limit() { return [aiRow]; } };
                },
              };
            },
          };
        }
        return {
          from() {
            return {
              where() {
                return { orderBy() { return { async limit() { return []; } }; } };
              },
            };
          },
        };
      },
    } as unknown as Database;

    await expect(getDecisionReview(db, "00000000-0000-4000-8000-000000000021"))
      .resolves.toMatchObject({
        decisionContextSnapshot: null,
        rule: { expression: "VALUE >= 3500.0000 USD OR DELIVERY_RATE < 58%" },
        ai: { status: "UNAVAILABLE", failureCode: "INVALID_RESPONSE", humanReviewRequired: true },
      });
  });

  it.each([
    ["tiny", 1e-7, "0.00001%"],
    ["zero", 0, "0%"],
    ["whole", 1, "100%"],
    ["two decimals", 0.58, "58%"],
    ["three decimals", 0.725, "72.5%"],
    ["floating point noise", 0.1 + 0.2, "30%"],
  ])("formats the %s delivery threshold honestly", async (_label, rate, expected) => {
    const review = await getDecisionReview(
      decisionReviewDb(rate),
      "00000000-0000-4000-8000-000000000021",
    );

    expect(review?.rule.expression).toBe(`VALUE >= 3500.0000 USD OR DELIVERY_RATE < ${expected}`);
  });

  it("validates fail-closed AI persistence before touching the database", async () => {
    await expect(
      recordAiDecision(rejectingDb, {
        requestId: "00000000-0000-4000-8000-000000000020",
        decisionCaseId: "00000000-0000-4000-8000-000000000021",
        status: "UNAVAILABLE",
        provider: "opencode-zen",
        model: "deepseek-v4-flash-free",
        promptVersion: "baseline-ai-prompt.v1",
        policyVersion: "risk-control-policy.v1",
        recommendation: "WATCH",
        confidence: null,
        reasonCodes: null,
        reason: null,
        humanReviewRequired: true,
        failureCode: "MISSING_API_KEY",
      } as never),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("persists SLOW_SELL planned methods as operator intent only", async () => {
    const inserted: unknown[] = [];
    const row = {
      id: "00000000-0000-4000-8000-000000000030",
      requestId: "00000000-0000-4000-8000-000000000031",
      decisionCaseId: "00000000-0000-4000-8000-000000000021",
      decision: "SLOW_SELL" as const,
      reasonCode: "LOW_DELIVERY_RATE" as const,
      confidence: null,
      reasonCodes: ["LOW_DELIVERY_RATE"] as const,
      plannedMethods: ["DISABLE_FLASH_SALE", "INCREASE_PRICE"] as const,
      note: null,
      notes: null,
      actor: "test-ba",
      createdAt: new Date("2026-08-14T00:01:00.000Z"),
    };
    const db = {
      insert(table: unknown) {
        expect(table).toBe(baDecisions);
        return {
          values(values: unknown) {
            inserted.push(values);
            return {
              onConflictDoNothing() {
                return { async returning() { return [row]; } };
              },
            };
          },
        };
      },
    } as unknown as Database;

    await expect(recordBaDecisionForCase(db, {
      requestId: row.requestId,
      decisionCaseId: row.decisionCaseId,
      baDecision: {
        decision: "SLOW_SELL",
        reasonCode: "LOW_DELIVERY_RATE",
        plannedMethods: ["DISABLE_FLASH_SALE", "INCREASE_PRICE"],
      },
    })).resolves.toBe(row);
    expect(inserted).toEqual([expect.objectContaining({
      decision: "SLOW_SELL",
      plannedMethods: ["DISABLE_FLASH_SALE", "INCREASE_PRICE"],
    })]);
  });

  it("rejects SLOW_SELL Holiday Mode execution before creating an execution", async () => {
    let insertCalled = false;
    const db = {
      transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
        select() {
          return {
            from() {
              return {
                where() {
                  return { async limit() { return [{ decision: "SLOW_SELL" }]; } };
                },
              };
            },
          };
        },
        insert() {
          insertCalled = true;
          throw new Error("execution insert must not be reached");
        },
      }),
    } as unknown as Database;

    await expect(recordDryRunExecution(db, {
      requestId: "00000000-0000-4000-8000-000000000032",
      decisionCaseId: "00000000-0000-4000-8000-000000000021",
      baDecisionId: "00000000-0000-4000-8000-000000000030",
      requestedAction: "HOLIDAY_MODE_ON",
      executionMode: "DRY_RUN",
    })).rejects.toThrow("requires a PAUSE BA decision");
    expect(insertCalled).toBe(false);
  });

  it("validates BA and execution request IDs before touching the database", async () => {
    await expect(
      recordBaDecisionForCase(rejectingDb, {
        requestId: "bad-request-id",
        decisionCaseId: "00000000-0000-4000-8000-000000000021",
        baDecision: input.baDecision,
      }),
    ).rejects.toBeInstanceOf(ZodError);

    await expect(
      recordDryRunExecution(rejectingDb, {
        requestId: "bad-request-id",
        decisionCaseId: "00000000-0000-4000-8000-000000000021",
        baDecisionId: "00000000-0000-4000-8000-000000000022",
        requestedAction: "HOLIDAY_MODE_ON",
        executionMode: "DRY_RUN",
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("fails closed when TOOL_BA_ACTOR is missing", async () => {
    const previous = process.env.TOOL_BA_ACTOR;
    delete process.env.TOOL_BA_ACTOR;
    try {
      await expect(recordBaDecisionForCase(rejectingDb, {
        requestId: "00000000-0000-4000-8000-000000000020",
        decisionCaseId: "00000000-0000-4000-8000-000000000021",
        baDecision: input.baDecision,
      })).rejects.toThrow("TOOL_BA_ACTOR is required");
    } finally {
      process.env.TOOL_BA_ACTOR = previous;
    }
  });
});
