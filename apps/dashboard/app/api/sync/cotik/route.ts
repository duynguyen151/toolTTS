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

    // Ingest latest already-synced COTIK data sequentially (Orders then Supplementary Finance)
    // to preserve per-shop non-reentrant advisory lock semantics.
    let ordersResult: Awaited<ReturnType<typeof runCotikOrdersSync>> | null = null;
    let ordersError: string | null = null;
    try {
      ordersResult = await runCotikOrdersSync({ context, shop, client });
    } catch (err: any) {
      ordersError = err?.message ?? String(err);
    }

    let financeResult: Awaited<ReturnType<typeof runCotikSupplementaryFinanceSync>> | null = null;
    let financeError: string | null = null;
    try {
      financeResult = await runCotikSupplementaryFinanceSync({ context, shop, client });
    } catch (err: any) {
      financeError = err?.message ?? String(err);
    }

    const ordersOk = ordersResult !== null && ordersResult.status === "SUCCEEDED";
    const financeOk = financeResult !== null && financeResult.status === "SUCCEEDED";
    const financeSkippedCapability = financeResult !== null
      && financeResult.status === "SKIPPED"
      && financeResult.skipReason === "COTIK_SUPPLEMENTARY_FINANCE_UNAVAILABLE";

    // Orders are required for COTIK normal sync. Supplementary Finance is optional
    // when unconfigured/unavailable on the binding, but if configured and fails/errors,
    // overall ok is false.
    const ok = ordersOk && (financeOk || financeSkippedCapability);

    return Response.json(
      {
        ok,
        profileNo: parsed.profileNo,
        shopId: shop.id,
        cotikOrders: ordersResult ?? { error: ordersError ?? "Orders sync failed" },
        cotikFinance: financeResult ?? { error: financeError ?? "Finance sync failed" },
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
