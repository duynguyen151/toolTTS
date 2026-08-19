import { randomUUID } from "node:crypto";

import {
  BaDecisionInputSchema,
  type RecordBaDecisionForCaseInput,
} from "@shop-health/domain";
import type { DecisionReviewRecord } from "@shop-health/db";

import {
  jsonHeaders,
  parseLocalJsonRequest,
} from "../../../../lib/server/operations/request.js";

export interface BaDecisionStore {
  getDecisionReview(caseId: string): Promise<DecisionReviewRecord | null>;
  isProfileReady(profileNo: string): Promise<boolean>;
  recordBaDecision(input: RecordBaDecisionForCaseInput): Promise<unknown>;
}

export interface BaDecisionHandlerOptions {
  readonly actor?: string | undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_NO_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function parseBaRequest(body: Record<string, unknown>): {
  profileNo: string;
  caseId: string;
  requestId?: string;
  baDecision: RecordBaDecisionForCaseInput["baDecision"];
} | null {
  const profileNo = body.profileNo;
  const caseId = body.caseId;
  const requestId = body.requestId;
  const baDecision = body.baDecision;
  if (typeof profileNo !== "string" || !PROFILE_NO_PATTERN.test(profileNo)) return null;
  if (typeof caseId !== "string" || !UUID_PATTERN.test(caseId)) return null;
  if (requestId !== undefined && (typeof requestId !== "string" || !UUID_PATTERN.test(requestId))) return null;
  const parsedBaDecision = BaDecisionInputSchema.safeParse(baDecision);
  if (!parsedBaDecision.success) return null;
  return {
    profileNo,
    caseId,
    ...(requestId === undefined ? {} : { requestId }),
    baDecision: parsedBaDecision.data,
  };
}

function errorResponse(status: 400 | 409 | 500 | 503, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: jsonHeaders() });
}

function historyRows(review: DecisionReviewRecord): Array<Record<string, unknown>> {
  const revisions = review.baHistory ?? (review.ba === null ? [] : [review.ba]);
  return revisions.map((revision) => ({
    id: revision.id,
    decision: revision.decision,
    reasonCode: revision.reasonCode,
    reasonCodes: revision.reasonCodes,
    actor: revision.actor,
    notes: revision.notes ?? revision.note,
    decidedAt: revision.decidedAt.toISOString(),
  }));
}

export function createBaDecisionHandler(
  store: BaDecisionStore,
  options: BaDecisionHandlerOptions = {},
) {
  return async function submitBaDecision(request: Request): Promise<Response> {
    const local = await parseLocalJsonRequest(request);
    if (!local.ok) return Response.json({ error: local.error }, { status: local.status, headers: jsonHeaders() });

    const parsed = parseBaRequest(local.body);
    if (parsed === null) {
      return errorResponse(400, "INVALID_REQUEST", "Decision, reason code, and valid case details are required.");
    }

    const actor = (options.actor ?? process.env.TOOL_BA_ACTOR)?.trim();
    if (!actor) return errorResponse(503, "BA_ACTOR_MISSING", "TOOL_BA_ACTOR is required for LIVE BA submissions.");

    let review: DecisionReviewRecord | null;
    try {
      review = await store.getDecisionReview(parsed.caseId);
    } catch {
      return errorResponse(500, "PERSISTENCE_FAILED", "The LIVE decision case could not be read.");
    }
    if (review === null || review.shop.profileNo !== parsed.profileNo) {
      return errorResponse(409, "CASE_NOT_FOUND", "The selected LIVE decision case was not found for this profile.");
    }
    if (review.case.origin !== "LIVE" || review.shop.dataOrigin !== "LIVE") {
      return errorResponse(409, "LIVE_CASE_REQUIRED", "BA submissions are available only for persisted LIVE decision cases.");
    }
    try {
      if (!await store.isProfileReady(parsed.profileNo)) {
        return errorResponse(409, "PROFILE_NOT_READY", "BA submissions require a READY and ELIGIBLE profile.");
      }
    } catch {
      return errorResponse(500, "PERSISTENCE_FAILED", "The profile eligibility could not be read.");
    }

    try {
      await store.recordBaDecision({
        requestId: parsed.requestId ?? randomUUID(),
        decisionCaseId: parsed.caseId,
        baDecision: parsed.baDecision,
      });
      const refreshed = await store.getDecisionReview(parsed.caseId);
      if (refreshed === null) return errorResponse(500, "PERSISTENCE_FAILED", "The BA decision could not be read back.");
      return Response.json({ ok: true, caseId: parsed.caseId, current: refreshed.ba?.decision ?? "NOT_REVIEWED", history: historyRows(refreshed) }, { headers: jsonHeaders() });
    } catch {
      return errorResponse(500, "PERSISTENCE_FAILED", "The BA decision could not be persisted.");
    }
  };
}
