import { Command } from "commander";
import { describe, expect, test, vi } from "vitest";

import type {
  DecisionHistoryPage,
  DecisionReviewView,
  DecisionWorkflow,
} from "@shop-health/decision-workflow";

import { registerReviewCommands } from "./review.js";

const caseId = "0df4a641-4555-4f4d-bb32-595f95ad3c7c";
const requestId = "8d0c6464-1976-4a2f-84fb-25e2cd6efea5";

const review = {
  schemaVersion: "decision-review.v1",
  case: { id: caseId },
} as DecisionReviewView;
const history = {
  schemaVersion: "decision-history.v1",
  items: [review],
  nextCursor: null,
} as DecisionHistoryPage;

function createWorkflow(): DecisionWorkflow {
  return {
    startReview: vi.fn(async () => review),
    show: vi.fn(async () => review),
    decide: vi.fn(async () => review),
    execute: vi.fn(async () => review),
    history: vi.fn(async () => history),
  };
}

async function run(workflow: DecisionWorkflow, args: string[]): Promise<string> {
  const program = new Command().exitOverride().configureOutput({ writeErr: () => undefined });
  let output = "";
  registerReviewCommands(program, workflow, {
    timeZone: "Asia/Bangkok",
    write: (value) => { output += value; },
  });
  await program.parseAsync(["node", "shop-health", ...args]);
  return output;
}

describe("review commands", () => {
  test("parses start and repeatable BA reason codes into non-interactive workflow calls", async () => {
    const workflow = createWorkflow();

    const startOutput = await run(workflow, [
      "review", "start", "DEMO-001", "--request-id", requestId, "--json",
    ]);
    await run(workflow, [
      "review", "decide", caseId,
      "--decision", "PAUSE",
      "--reason-code", "HIGH_ABSOLUTE_EXPOSURE",
      "--reason-code", "DATA_INCOMPLETE",
      "--confidence", "0.85",
      "--note", "Review complete",
      "--request-id", requestId,
      "--json",
    ]);

    expect(workflow.startReview).toHaveBeenCalledWith({ profileNo: "DEMO-001", requestId });
    expect(workflow.decide).toHaveBeenCalledWith({
      caseId,
      decision: "PAUSE",
      reasonCode: "HIGH_ABSOLUTE_EXPOSURE",
      reasonCodes: ["HIGH_ABSOLUTE_EXPOSURE", "DATA_INCOMPLETE"],
      confidence: 0.85,
      note: "Review complete",
      requestId,
    });
    expect(JSON.parse(startOutput)).toEqual(review);
  });

  test("submits each of the five BA decisions, including repeatable SLOW_SELL methods", async () => {
    for (const selectedDecision of ["SCALE", "CONTINUE", "WATCH", "PAUSE", "SLOW_SELL"] as const) {
      const workflow = createWorkflow();
      const args = [
        "review", "decide", caseId,
        "--decision", selectedDecision,
        "--reason-code", "LOW_DELIVERY_RATE",
        "--json",
      ];
      if (selectedDecision === "SLOW_SELL") {
        args.splice(-1, 0,
          "--planned-method", "DISABLE_FLASH_SALE",
          "--planned-method", "INCREASE_PRICE",
          "--notes", "Operator will slow new demand.",
        );
      }

      await run(workflow, args);

      expect(workflow.decide).toHaveBeenCalledWith({
        caseId,
        decision: selectedDecision,
        reasonCode: "LOW_DELIVERY_RATE",
        reasonCodes: ["LOW_DELIVERY_RATE"],
        ...(selectedDecision === "SLOW_SELL" ? {
          plannedMethods: ["DISABLE_FLASH_SALE", "INCREASE_PRICE"],
          notes: "Operator will slow new demand.",
        } : {}),
      });
    }
  });

  test("rejects SLOW_SELL without methods and planned OTHER without notes before workflow submission", async () => {
    const workflow = createWorkflow();

    await expect(run(workflow, [
      "review", "decide", caseId,
      "--decision", "SLOW_SELL",
      "--reason-code", "LOW_DELIVERY_RATE",
      "--json",
    ])).rejects.toThrow("SLOW_SELL requires at least one planned method");
    await expect(run(workflow, [
      "review", "decide", caseId,
      "--decision", "SLOW_SELL",
      "--reason-code", "LOW_DELIVERY_RATE",
      "--planned-method", "OTHER",
      "--json",
    ])).rejects.toThrow("BA notes are required for planned method OTHER");
    expect(workflow.decide).not.toHaveBeenCalled();
  });

  test("appends repeated revisions by the same persisted case ID", async () => {
    const workflow = createWorkflow();

    await run(workflow, [
      "review", "decide", caseId,
      "--decision", "SLOW_SELL",
      "--reason-code", "LOW_DELIVERY_RATE",
      "--planned-method", "DISABLE_FLASH_SALE",
      "--notes", "First operator revision",
      "--json",
    ]);
    await run(workflow, [
      "review", "decide", caseId,
      "--decision", "PAUSE",
      "--reason-code", "HIGH_ABSOLUTE_EXPOSURE",
      "--json",
    ]);

    expect(workflow.decide).toHaveBeenNthCalledWith(1, expect.objectContaining({
      caseId,
      decision: "SLOW_SELL",
      plannedMethods: ["DISABLE_FLASH_SALE"],
      notes: "First operator revision",
    }));
    expect(workflow.decide).toHaveBeenNthCalledWith(2, {
      caseId,
      decision: "PAUSE",
      reasonCode: "HIGH_ABSOLUTE_EXPOSURE",
      reasonCodes: ["HIGH_ABSOLUTE_EXPOSURE"],
    });
    const decideCalls = (workflow.decide as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[
      { readonly caseId: string },
    ]>;
    expect(decideCalls.every(([input]) => input.caseId === caseId)).toBe(true);
  });

  test("show and history are read-only workflow calls", async () => {
    const workflow = createWorkflow();

    await run(workflow, ["review", "show", caseId, "--json"]);
    await run(workflow, [
      "review", "history", "DEMO-001", "--limit", "25", "--cursor", "cursor-2", "--json",
    ]);

    expect(workflow.show).toHaveBeenCalledWith(caseId);
    expect(workflow.history).toHaveBeenCalledWith({
      profileNo: "DEMO-001",
      limit: 25,
      cursor: "cursor-2",
    });
    expect(workflow.startReview).not.toHaveBeenCalled();
    expect(workflow.decide).not.toHaveBeenCalled();
    expect(workflow.execute).not.toHaveBeenCalled();
  });

  test("execute requires the explicit --confirm flag before calling the workflow", async () => {
    const workflow = createWorkflow();

    await expect(run(workflow, ["review", "execute", caseId, "--json"]))
      .rejects.toThrow("--confirm");
    expect(workflow.execute).not.toHaveBeenCalled();

    await run(workflow, [
      "review", "execute", caseId, "--confirm", "--request-id", requestId, "--json",
    ]);
    expect(workflow.execute).toHaveBeenCalledWith({ caseId, confirm: true, requestId });
  });
});
