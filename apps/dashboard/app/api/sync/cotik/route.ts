import { jsonHeaders, parseLocalProfileRequest } from "../../../../lib/server/operations/request.js";
import { runCotikOrdersSync, runCotikSupplementaryFinanceSync } from "@shop-health/sync";
import { findShopByProfileNo, createDatabase, closeDatabase } from "@shop-health/db";
import { createCotikClient } from "@shop-health/cotik";

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseLocalProfileRequest(request);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: parsed.status, headers: jsonHeaders() });
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return Response.json(
      { error: { code: "DATABASE_UNAVAILABLE", message: "DATABASE_URL is not configured." } },
      { status: 503, headers: jsonHeaders() }
    );
  }

  const cotikToken = process.env.COTIK_TOKEN?.trim() || process.env.COTIK_API_KEY?.trim();
  if (!cotikToken) {
    return Response.json(
      { error: { code: "COTIK_TOKEN_MISSING", message: "COTIK_TOKEN or COTIK_API_KEY is not configured." } },
      { status: 500, headers: jsonHeaders() }
    );
  }

  const client = createCotikClient({
    baseUrl: process.env.COTIK_BASE_URL ?? "https://cotik.app/api",
    token: cotikToken,
  });

  const context = createDatabase(databaseUrl);
  try {
    const shop = await findShopByProfileNo(context.db, parsed.profileNo);
    if (!shop) {
      return Response.json(
        { error: { code: "SHOP_NOT_FOUND", message: `Shop for profile ${parsed.profileNo} not found.` } },
        { status: 404, headers: jsonHeaders() }
      );
    }

    // Ingest latest already-synced COTIK data (Orders and Supplementary Finance)
    const [ordersResult, financeResult] = await Promise.allSettled([
      runCotikOrdersSync({ context, shop, client }),
      runCotikSupplementaryFinanceSync({ context, shop, client }),
    ]);

    const ordersFulfilled = ordersResult.status === "fulfilled";
    const financeFulfilled = financeResult.status === "fulfilled";

    const ordersOk = ordersFulfilled && ordersResult.value.status === "SUCCEEDED";
    const financeOk = financeFulfilled && financeResult.value.status === "SUCCEEDED";

    return Response.json(
      {
        ok: ordersOk || financeOk,
        profileNo: parsed.profileNo,
        shopId: shop.id,
        cotikOrders: ordersFulfilled ? ordersResult.value : { error: String((ordersResult as any).reason) },
        cotikFinance: financeFulfilled ? financeResult.value : { error: String((financeResult as any).reason) },
      },
      { headers: jsonHeaders() }
    );
  } catch (err: any) {
    return Response.json(
      { error: { code: "COTIK_INGEST_ERROR", message: err.message ?? "Failed to ingest COTIK data." } },
      { status: 500, headers: jsonHeaders() }
    );
  } finally {
    await closeDatabase(context);
  }
}
