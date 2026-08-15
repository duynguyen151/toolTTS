import { getDashboardOperations } from "../../../../lib/server/operations/runtime.js";
import { createOpenProfileHandler } from "./handler.js";

export async function POST(request: Request): Promise<Response> {
  return createOpenProfileHandler(getDashboardOperations())(request);
}
