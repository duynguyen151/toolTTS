import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import type { Database } from "../client.js";
import { baDecisions, decisionCases } from "../schema.js";
import { captureBaDecision, type CaptureBaDecisionInput } from "../index.js";

const input: CaptureBaDecisionInput = {
  decisionCase: {
    shopId: "00000000-0000-4000-8000-000000000001",
    observedAt: new Date("2026-08-14T00:00:00.000Z"),
    metricsSnapshot: {
      window: "FULL_PERSISTED_HISTORY",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-14T00:00:00.000Z",
      totalOrders: 120,
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
    },
    financeSnapshot: {
      capturedAt: "2026-08-14T00:00:00.000Z",
      currency: "USD",
      availableBalance: "2400.0000",
      frozenBalance: "100.0000",
      totalBalance: "2500.0000",
      toSettleBalance: "800.0000",
      onHoldBalance: "1200.0000",
      settlementCount: 40,
      onHoldSettlementCount: 6,
    },
    ruleDecision: "CONTINUE",
    ruleTriggers: [],
    dataCoverage: "COMPLETE",
    sourceSyncRunId: null,
  },
  baDecision: {
    decision: "WATCH",
    confidence: 0.75,
    reasonCodes: ["HIGH_ABSOLUTE_EXPOSURE"],
    note: "Monitor settlement",
  },
};

function transactionDouble(options?: { failBaInsert?: boolean }): {
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
        confidence: "0.75",
        reasonCodes: ["HIGH_ABSOLUTE_EXPOSURE"],
        note: "Monitor settlement",
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
});
