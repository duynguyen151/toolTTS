import {
  CaptureBaDecisionInputSchema,
  type CaptureBaDecisionInput,
} from "@shop-health/domain";

export type {
  BaDecisionInput,
  CaptureBaDecisionInput,
  DecisionCaseInput,
} from "@shop-health/domain";

import type { Database } from "../client.js";
import {
  baDecisions,
  decisionCases,
  type BaDecisionRow,
  type DecisionCaseRow,
} from "../schema.js";

export interface CapturedBaDecision {
  decisionCase: DecisionCaseRow;
  baDecision: BaDecisionRow;
}

export async function captureBaDecision(
  db: Database,
  input: CaptureBaDecisionInput,
): Promise<CapturedBaDecision> {
  const parsed = CaptureBaDecisionInputSchema.parse(input);

  return db.transaction(async (transaction) => {
    const [decisionCase] = await transaction
      .insert(decisionCases)
      .values(parsed.decisionCase)
      .returning();

    if (!decisionCase) {
      throw new Error("Failed to create decision case");
    }

    const [baDecision] = await transaction
      .insert(baDecisions)
      .values({
        decisionCaseId: decisionCase.id,
        decision: parsed.baDecision.decision,
        confidence:
          parsed.baDecision.confidence === undefined
            ? null
            : parsed.baDecision.confidence.toString(),
        reasonCodes: parsed.baDecision.reasonCodes,
        note: parsed.baDecision.note ?? null,
      })
      .returning();

    if (!baDecision) {
      throw new Error("Failed to create BA decision");
    }

    return { decisionCase, baDecision };
  });
}
