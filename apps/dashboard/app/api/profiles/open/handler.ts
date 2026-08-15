import type { DashboardOperations } from "../../../../lib/server/operations/dashboard-operations.js";
import { jsonHeaders, parseLocalProfileRequest } from "../../../../lib/server/operations/request.js";

export function createOpenProfileHandler(operations: DashboardOperations) {
  return async function openProfile(request: Request): Promise<Response> {
    const parsed = await parseLocalProfileRequest(request);
    if (!parsed.ok) {
      return Response.json({ error: parsed.error }, { status: parsed.status, headers: jsonHeaders() });
    }

    const result = await operations.openProfile(parsed.profileNo);
    return Response.json(result, { status: 200, headers: jsonHeaders() });
  };
}
