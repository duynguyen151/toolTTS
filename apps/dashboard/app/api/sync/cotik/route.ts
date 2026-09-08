import { jsonHeaders, parseLocalProfileRequest } from "../../../../lib/server/operations/request.js";
import { runCotikOrdersSync, runCotikSupplementaryFinanceSync } from "@shop-health/sync";
import { findShopByProfileNo, createDatabase, closeDatabase, upsertShopProviderBinding } from "@shop-health/db";
import { createCotikClient } from "@shop-health/cotik";
import { revalidatePath } from "next/cache";

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseLocalProfileRequest(request);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: parsed.status, headers: jsonHeaders() });
  }

  const globalFallbackToken =
    process.env.COTIK_TOKEN?.trim() ||
    process.env.COTIK_API_KEY?.trim() ||
    process.env.COTIK_TOKEN_TUAN?.trim() ||
    process.env.COTIK_TOKEN_HANG?.trim() ||
    process.env.COTIK_TOKEN_VIET?.trim() ||
    process.env.COTIK_TOKEN_CHUC?.trim() ||
    process.env.COTIK_TOKEN_LAN?.trim();

  if (!globalFallbackToken) {
    return Response.json(
      { error: { code: "COTIK_TOKEN_MISSING", message: "COTIK_TOKEN or COTIK_API_KEY is not configured." } },
      { status: 500, headers: jsonHeaders() }
    );
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return Response.json(
      { error: { code: "DATABASE_UNAVAILABLE", message: "DATABASE_URL is not configured." } },
      { status: 503, headers: jsonHeaders() }
    );
  }

  const context = createDatabase(databaseUrl);
  try {
    const shop = await findShopByProfileNo(context.db, parsed.profileNo);
    if (!shop) {
      return Response.json(
        { error: { code: "SHOP_NOT_FOUND", message: `Shop for profile ${parsed.profileNo} not found.` } },
        { status: 404, headers: jsonHeaders() }
      );
    }

    // Resolve specific token from provider binding checkpoint, or fallback
    const binding = context?.db?.query?.shopProviderBindings?.findFirst
      ? await context.db.query.shopProviderBindings.findFirst({
          where: (table: any, { eq, and }: any) => and(eq(table.shopId, shop.id), eq(table.provider, "COTIK")),
        }).catch(() => null)
      : null;

    const prov = binding?.provenance as Record<string, unknown> | undefined;
    const cp = binding?.checkpoint as Record<string, unknown> | undefined;
    const tokenKey = (prov?.tokenKey as string | undefined) || (cp?.tokenKey as string | undefined);
    const cotikToken = (tokenKey ? process.env[tokenKey]?.trim() : undefined) || globalFallbackToken;

    const client = createCotikClient({
      baseUrl: process.env.COTIK_BASE_URL ?? "https://cotik.app/api",
      token: cotikToken,
    });

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
    const ordersSkipReason = (ordersResult as any)?.status === "SKIPPED" ? (ordersResult as any).skipReason : null;
    const financeSkipReason = (financeResult as any)?.status === "SKIPPED" && !financeSkippedCapability ? (financeResult as any).skipReason : null;
    const errorMessage = !ok
      ? (ordersError || ordersSkipReason || financeError || financeSkipReason || "Đồng bộ COTIK thất bại")
      : undefined;

    // Query latest analytic on-hold for this shop from COTIK to capture sum_est_settlement_amount
    let analyticData: {
      sumEstSettlementAmount: number | null;
      estimatedSettlement: string | null;
      onHoldBuckets: Record<string, unknown> | null;
    } | null = null;

    if (cotikToken && binding) {
      try {
        const baseUrl = process.env.COTIK_BASE_URL ?? "https://cotik.app/api";
        const [analyticShopRes, onHoldRes] = await Promise.all([
          fetch(`${baseUrl}/analytic/shop`, {
            headers: { "al-token": cotikToken, Accept: "application/json" },
          }).then((r) => r.json()).catch(() => null),
          binding.providerShopId
            ? fetch(`${baseUrl}/analytic/on-hold?shop=${binding.providerShopId}`, {
                headers: { "al-token": cotikToken, Accept: "application/json" },
              }).then((r) => r.json()).catch(() => null)
            : Promise.resolve(null),
        ]);

        const cotikShops = analyticShopRes?.data?.data || [];
        const matched = cotikShops.find(
          (s: any) => s._id === binding.providerShopId || (s.note && s.note.includes(parsed.profileNo)),
        );

        if (matched) {
          const rawSum = typeof matched.sum_est_settlement_amount === "number"
            ? matched.sum_est_settlement_amount
            : Number(matched.sum_est_settlement_amount) || 0;
          const estSettlement = typeof matched.estimated_settlement === "string"
            ? matched.estimated_settlement
            : null;
          const buckets = onHoldRes?.data && typeof onHoldRes.data === "object" ? onHoldRes.data : null;

          analyticData = {
            sumEstSettlementAmount: rawSum,
            estimatedSettlement: estSettlement,
            onHoldBuckets: buckets,
          };

          const prevProv = (binding.provenance as Record<string, unknown>) || {};
          const updatedProv = {
            ...prevProv,
            sumEstSettlementAmount: rawSum,
            estimatedSettlement: estSettlement,
            onHoldBuckets: buckets,
            cotikShopId: matched._id,
          };

          await upsertShopProviderBinding(context.db, {
            shopId: shop.id,
            provider: "COTIK",
            providerShopId: matched._id,
            enabled: true,
            provenance: updatedProv as any,
            checkpoint: binding.checkpoint as any,
          });
        }
      } catch {
        // non-blocking
      }
    }

    try {
      revalidatePath("/", "layout");
    } catch {
      // safe fallback in test environments
    }

    return Response.json(
      {
        ok,
        profileNo: parsed.profileNo,
        shopId: shop.id,
        message: errorMessage,
        error: errorMessage ? { code: "SYNC_FAILED", message: errorMessage } : undefined,
        cotikOrders: ordersResult ?? { error: ordersError ?? "Orders sync failed" },
        cotikFinance: financeResult ?? { error: financeError ?? "Finance sync failed" },
        cotikAnalytics: analyticData,
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
