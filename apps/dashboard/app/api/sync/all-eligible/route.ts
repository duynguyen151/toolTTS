import { getDashboardOperations } from "../../../../lib/server/operations/runtime.js";
import { jsonHeaders, parseLocalProfileRequest } from "../../../../lib/server/operations/request.js";

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseLocalProfileRequest(request);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status, headers: jsonHeaders() });
  return Response.json(await getDashboardOperations().syncAllEligible(), { headers: jsonHeaders() });
}
