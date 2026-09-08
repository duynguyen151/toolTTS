import { jsonHeaders } from "../../../../../lib/server/operations/request.js";
import { runCotikOrdersSync, runCotikSupplementaryFinanceSync } from "@shop-health/sync";
import { createDatabase, closeDatabase, findShopById } from "@shop-health/db";
import { createCotikClient } from "@shop-health/cotik";
import { KNOWN_COTIK_ACCOUNTS } from "../../../../../lib/cotik-account-types";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export interface AccountSyncDetail {
  shopId: string;
  profileNo: string;
  displayName: string;
  status: "SUCCEEDED" | "FAILED";
  ordersCount: number;
  financeCount: number;
  ordersMode?: string | null;
  error?: string | null;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." } },
      { status: 400, headers: jsonHeaders() }
    );
  }

  const accountKey = typeof (body as any)?.accountKey === "string" ? (body as any).accountKey.trim().toLowerCase() : "";
  if (!accountKey) {
    return Response.json(
      { error: { code: "ACCOUNT_KEY_REQUIRED", message: "accountKey is required." } },
      { status: 400, headers: jsonHeaders() }
    );
  }

  const accountConfig = KNOWN_COTIK_ACCOUNTS.find((a) => a.key.toLowerCase() === accountKey);
  if (!accountConfig) {
    return Response.json(
      {
        error: {
          code: "ACCOUNT_NOT_FOUND",
          message: `Không tìm thấy tài khoản COTIK với mã '${accountKey}'. Các tài khoản hỗ trợ: ${KNOWN_COTIK_ACCOUNTS.map((a) => a.key).join(", ")}.`,
        },
      },
      { status: 404, headers: jsonHeaders() }
    );
  }

  const token = process.env[accountConfig.tokenKey]?.trim();
  if (!token) {
    return Response.json(
      {
        error: {
          code: "COTIK_TOKEN_MISSING",
          message: `Biến môi trường ${accountConfig.tokenKey} cho tài khoản ${accountConfig.name} chưa được cấu hình.`,
        },
      },
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
    // Find all shop bindings matching this account
    const bindings = context?.db?.query?.shopProviderBindings?.findMany
      ? await context.db.query.shopProviderBindings.findMany({
          where: (table: any, { eq, and }: any) => and(eq(table.provider, "COTIK"), eq(table.enabled, true)),
        }).catch(() => [])
      : [];

    // Filter bindings belonging to this accountKey or tokenKey
    const targetBindings = (bindings as any[]).filter((b) => {
      const prov = b.provenance as Record<string, unknown> | undefined;
      const cp = b.checkpoint as Record<string, unknown> | undefined;
      const tKey = (prov?.tokenKey as string | undefined) || (cp?.tokenKey as string | undefined);
      const aKey = (prov?.accountKey as string | undefined) || (cp?.accountName as string | undefined)?.toLowerCase();
      return tKey === accountConfig.tokenKey || aKey === accountConfig.key;
    });

    const client = createCotikClient({
      baseUrl: process.env.COTIK_BASE_URL ?? "https://cotik.app/api",
      token,
    });

    const details: AccountSyncDetail[] = [];
    let succeededCount = 0;
    let failedCount = 0;

    for (const binding of targetBindings) {
      const shop = await findShopById(context.db, binding.shopId);
      if (!shop) continue;

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
      const financeOk = financeResult !== null && (financeResult.status === "SUCCEEDED" || financeResult.status === "SKIPPED");
      const shopOk = ordersOk && financeOk;

      if (shopOk) {
        succeededCount++;
        details.push({
          shopId: shop.id,
          profileNo: shop.profileNo,
          displayName: shop.displayName || `Shop ${shop.profileNo}`,
          status: "SUCCEEDED",
          ordersCount: ordersResult?.rowsWritten ?? 0,
          financeCount: financeResult?.rowsWritten ?? 0,
          ordersMode: ordersResult?.mode ?? null,
          error: null,
        });
      } else {
        failedCount++;
        details.push({
          shopId: shop.id,
          profileNo: shop.profileNo,
          displayName: shop.displayName || `Shop ${shop.profileNo}`,
          status: "FAILED",
          ordersCount: 0,
          financeCount: 0,
          error: ordersError || financeError || "Lỗi đồng bộ",
        });
      }

      // Small pacing delay between shops
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const overallOk = failedCount === 0;

    try {
      revalidatePath("/", "layout");
    } catch {
      // safe fallback in test environments
    }

    return Response.json(
      {
        ok: overallOk,
        accountKey: accountConfig.key,
        accountName: accountConfig.name,
        tokenKey: accountConfig.tokenKey,
        totalShops: targetBindings.length,
        succeededShops: succeededCount,
        failedShops: failedCount,
        message: overallOk
          ? `Đã đồng bộ thành công toàn bộ ${succeededCount} cửa hàng thuộc tài khoản ${accountConfig.name}.`
          : `Đồng bộ hoàn tất: ${succeededCount} thành công, ${failedCount} thất bại.`,
        details,
      },
      { headers: jsonHeaders() }
    );
  } catch (err: any) {
    return Response.json(
      { error: { code: "ACCOUNT_SYNC_ERROR", message: err.message ?? "Lỗi đồng bộ tài khoản COTIK." } },
      { status: 500, headers: jsonHeaders() }
    );
  } finally {
    await closeDatabase(context);
  }
}
