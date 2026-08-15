import { getDashboardOperations } from "../../../lib/server/operations/runtime.js";
import { createUpdateDataHandler } from "./handler.js";

export async function POST(request: Request): Promise<Response> {
  return createUpdateDataHandler(getDashboardOperations())(request);
}
