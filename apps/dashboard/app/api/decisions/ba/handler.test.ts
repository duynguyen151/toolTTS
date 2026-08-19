import { describe, expect, it, vi } from "vitest";

import { createBaDecisionHandler, type BaDecisionStore } from "./handler.js";

const caseId = "00000000-0000-4000-8000-000000000001";

function request(body: unknown, url = "http://127.0.0.1:3000/api/decisions/ba"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function store(overrides: Partial<BaDecisionStore> = {}): BaDecisionStore {
  return {
    getDecisionReview: vi.fn().mockResolvedValue({
      case: { id: caseId, origin: "LIVE", observedAt: new Date(), createdAt: new Date() },
      shop: { id: "shop-1", profileNo: "957", displayName: "Live shop", currency: "USD", dataOrigin: "LIVE", dataCoverage: "COMPLETE", lastSyncAt: null },
      ba: null,
      baHistory: [],
    }),
    isProfileReady: vi.fn().mockResolvedValue(true),
    recordBaDecision: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("POST /api/decisions/ba", () => {
  it("rejects a missing decision before persistence", async () => {
    const persistence = vi.fn();
    const response = await createBaDecisionHandler(store({ recordBaDecision: persistence }))(
      request({ profileNo: "957", caseId, baDecision: { reasonCode: "LOW_DELIVERY_RATE" } }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(persistence).not.toHaveBeenCalled();
  });

  it("requires notes when the reason code is OTHER", async () => {
    const persistence = vi.fn();
    const response = await createBaDecisionHandler(store({ recordBaDecision: persistence }))(
      request({ profileNo: "957", caseId, baDecision: { decision: "WATCH", reasonCode: "OTHER" } }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(persistence).not.toHaveBeenCalled();
  });

  it("fails closed when the BA actor is missing", async () => {
    const persistence = vi.fn();
    const response = await createBaDecisionHandler(store({ recordBaDecision: persistence }), { actor: "" })(
      request({ profileNo: "957", caseId, baDecision: { decision: "PAUSE", reasonCode: "LOW_DELIVERY_RATE" } }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "BA_ACTOR_MISSING" } });
    expect(persistence).not.toHaveBeenCalled();
  });

  it("persists only a LIVE case and returns the refreshed revision history", async () => {
    const refreshed = {
      case: { id: caseId, origin: "LIVE", observedAt: new Date(), createdAt: new Date() },
      shop: { id: "shop-1", profileNo: "957", displayName: "Live shop", currency: "USD", dataOrigin: "LIVE", dataCoverage: "COMPLETE", lastSyncAt: null },
      ba: { id: "ba-2", decision: "WATCH", reasonCode: "DATA_INCOMPLETE", actor: "TOOL_BA_ACTOR", notes: "Review coverage", note: "Review coverage", reasonCodes: ["DATA_INCOMPLETE"], confidence: null, decidedAt: new Date() },
      baHistory: [
        { id: "ba-2", decision: "WATCH", reasonCode: "DATA_INCOMPLETE", actor: "TOOL_BA_ACTOR", notes: "Review coverage", note: "Review coverage", reasonCodes: ["DATA_INCOMPLETE"], confidence: null, decidedAt: new Date() },
        { id: "ba-1", decision: "CONTINUE", reasonCode: "RECOVERY_TREND", actor: "TOOL_BA_ACTOR", notes: null, note: null, reasonCodes: ["RECOVERY_TREND"], confidence: null, decidedAt: new Date("2026-08-15T00:00:00.000Z") },
      ],
    };
    const getDecisionReview = vi.fn()
      .mockResolvedValueOnce({ ...refreshed, ba: null, baHistory: [] })
      .mockResolvedValueOnce(refreshed);
    const recordBaDecision = vi.fn().mockResolvedValue(undefined);

    const response = await createBaDecisionHandler(store({ getDecisionReview, recordBaDecision }), { actor: "TOOL_BA_ACTOR" })(
      request({ profileNo: "957", caseId, baDecision: { decision: "WATCH", reasonCode: "DATA_INCOMPLETE", notes: "Review coverage" } }),
    );

    expect(response.status).toBe(200);
    expect(recordBaDecision).toHaveBeenCalledWith(expect.objectContaining({
      decisionCaseId: caseId,
      baDecision: expect.objectContaining({ decision: "WATCH", reasonCode: "DATA_INCOMPLETE", notes: "Review coverage" }),
    }));
    expect(await response.json()).toMatchObject({ ok: true, caseId, history: [{ id: "ba-2" }, { id: "ba-1" }] });
  });

  it("rejects a LIVE decision case when its profile is no longer READY", async () => {
    const persistence = vi.fn();
    const response = await createBaDecisionHandler(store({
      isProfileReady: vi.fn().mockResolvedValue(false),
      recordBaDecision: persistence,
    }), { actor: "TOOL_BA_ACTOR" })(
      request({ profileNo: "957", caseId, baDecision: { decision: "WATCH", reasonCode: "LOW_DELIVERY_RATE" } }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "PROFILE_NOT_READY" } });
    expect(persistence).not.toHaveBeenCalled();
  });

  it("rejects a sanitized case even when it exists", async () => {
    const persistence = vi.fn();
    const response = await createBaDecisionHandler(store({
      getDecisionReview: vi.fn().mockResolvedValue({
        case: { id: caseId, origin: "DEMO_SANITIZED", observedAt: new Date(), createdAt: new Date() },
        shop: { id: "shop-1", profileNo: "957", displayName: "Demo shop", currency: "USD", dataOrigin: "DEMO_SANITIZED", dataCoverage: "COMPLETE", lastSyncAt: null },
        ba: null,
        baHistory: [],
      }),
      recordBaDecision: persistence,
    }), { actor: "TOOL_BA_ACTOR" })(
      request({ profileNo: "957", caseId, baDecision: { decision: "CONTINUE", reasonCode: "RECOVERY_TREND" } }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "LIVE_CASE_REQUIRED" } });
    expect(persistence).not.toHaveBeenCalled();
  });
});
