import type { DashboardOperations } from "../../../../lib/server/operations/dashboard-operations.js";
import { jsonHeaders, parseLocalJsonRequest } from "../../../../lib/server/operations/request.js";

export function createRetryProfilesHandler(operations: DashboardOperations) {
  return async function retryProfiles(request: Request): Promise<Response> {
    const parsed = await parseLocalJsonRequest(request);
    if (!parsed.ok) {
      return Response.json({ error: parsed.error }, { status: parsed.status, headers: jsonHeaders() });
    }

    try {
      const result = await operations.listProfiles(undefined, { forceRefresh: true });
      return Response.json(result, {
        status: result.status === "ERROR" ? 503 : 200,
        headers: jsonHeaders(),
      });
    } catch {
      return Response.json({
        status: "ERROR",
        selectedProfileNo: null,
        profiles: [],
        error: {
          code: "ADSPOWER_UNAVAILABLE",
          message: "Dashboard could not reach the AdsPower Local API. Retry the operation.",
        },
      }, { status: 503, headers: jsonHeaders() });
    }
  };
}
