import {
  closeDatabase,
  createDatabase,
  getDecisionReview,
  listReadyAdsPowerProfileShops,
  recordBaDecisionForCase,
} from "@shop-health/db";

import { jsonHeaders } from "../../../../lib/server/operations/request.js";
import { createBaDecisionHandler, type BaDecisionStore } from "./handler.js";

export async function POST(request: Request): Promise<Response> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return Response.json(
      { error: { code: "DATABASE_UNAVAILABLE", message: "A configured LIVE database is required for BA submissions." } },
      { status: 503, headers: jsonHeaders() },
    );
  }

  const context = createDatabase(databaseUrl);
  const store: BaDecisionStore = {
    getDecisionReview: (caseId) => getDecisionReview(context.db, caseId),
    isProfileReady: async (profileNo) => (await listReadyAdsPowerProfileShops(context.db))
      .some((shop) => shop.profileNo === profileNo),
    recordBaDecision: (input) => recordBaDecisionForCase(context.db, input),
  };
  try {
    return await createBaDecisionHandler(store)(request);
  } finally {
    await closeDatabase(context);
  }
}
