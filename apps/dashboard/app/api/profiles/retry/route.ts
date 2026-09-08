import { getDashboardOperations } from "../../../../lib/server/operations/runtime.js";
import { createRetryProfilesHandler } from "./handler.js";

export async function POST(request: Request): Promise<Response> {
  return createRetryProfilesHandler(getDashboardOperations())(request);
}
