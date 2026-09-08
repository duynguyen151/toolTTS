import { closeDatabase, createDatabase, findCotikLogicalShopById } from "@shop-health/db";
import { stageCotikTracking } from "@shop-health/sync";

import { errorResponse, jsonHeaders, parseCotikJsonRequest, parseTrackingRequest } from "../../../../lib/cotik-route.js";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guarded = await parseCotikJsonRequest(request);
  if (!guarded.ok) return Response.json({ error: guarded.error }, { status: guarded.status, headers: jsonHeaders() });

  let input;
  try {
    input = parseTrackingRequest(guarded.body);
  } catch (error) {
    return errorResponse("INVALID_REQUEST", error instanceof Error ? error.message : "Invalid tracking request.", 400);
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return errorResponse("DATABASE_UNAVAILABLE", "DATABASE_URL is required.", 503);

  const context = createDatabase(databaseUrl);
  try {
    const logicalShop = await findCotikLogicalShopById(context.db, input.logicalShopId);
    if (!logicalShop) return errorResponse("LOGICAL_SHOP_NOT_FOUND", "The selected Cotik logical shop was not found.", 404);
    if (logicalShop.region !== input.region) {
      return errorResponse("REGION_MISMATCH", "The selected region does not match the logical shop.", 409);
    }
    if (logicalShop.region !== "US" && logicalShop.region !== "UK") {
      return errorResponse("REGION_UNAVAILABLE", "The logical shop has no supported region.", 409);
    }

    const result = await stageCotikTracking(context.db, {
      logicalShopId: logicalShop.id,
      orderId: input.orderId,
      tracking: input.tracking,
      provider: input.provider,
      region: logicalShop.region,
    });
    return Response.json(result, { headers: jsonHeaders() });
  } catch (error) {
    return errorResponse("COTIK_TRACKING_STAGE_FAILED", "Tracking could not be staged.", 503);
  } finally {
    await closeDatabase(context);
  }
}
