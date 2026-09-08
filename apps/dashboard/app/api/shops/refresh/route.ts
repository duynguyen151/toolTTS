import { jsonHeaders } from "../../../../lib/server/operations/request.js";
import {
  createDatabase,
  closeDatabase,
  findShopByProfileNo,
  updateShopDisplayName,
  createShop,
  findEnabledShopProviderBinding,
  upsertShopProviderBinding,
} from "@shop-health/db";

export const dynamic = "force-dynamic";

const COTIK_TOKEN_KEYS = [
  "COTIK_TOKEN_TUAN",
  "COTIK_TOKEN_HANG",
  "COTIK_TOKEN_VIET",
  "COTIK_TOKEN_CHUC",
  "COTIK_TOKEN_LAN",
] as const;

interface CotikShopItem {
  _id: string;
  name: string;
  note?: string;
  region?: string;
  ownerId?: string;
  createdBy?: string;
  estimated_settlement?: string;
  sum_est_settlement_amount?: number | string;
}

interface CotikShopResponse {
  status: number;
  message?: string;
  data?: {
    data?: CotikShopItem[];
  };
}

function extractProfileNo(note?: string, id?: string): string {
  if (note) {
    const leadingMatch = note.trim().match(/^(\d+)/);
    if (leadingMatch && leadingMatch[1]) {
      return leadingMatch[1];
    }
    const anyDigitsMatch = note.trim().match(/(\d{3,5})/);
    if (anyDigitsMatch && anyDigitsMatch[1]) {
      return anyDigitsMatch[1];
    }
  }
  return id ? id.slice(-6) : `shop-${Date.now()}`;
}

export async function POST(): Promise<Response> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return Response.json(
      { ok: false, error: { code: "DATABASE_UNAVAILABLE", message: "DATABASE_URL is not configured." } },
      { status: 503, headers: jsonHeaders() },
    );
  }

  const baseUrl = (process.env.COTIK_BASE_URL ?? "https://cotik.app/api").replace(/\/$/, "");
  const context = createDatabase(databaseUrl);

  const resultsByToken: Array<{
    tokenKey: string;
    status: number | null;
    shopCount: number;
    error?: string;
  }> = [];

  let totalUpdated = 0;
  let totalCreated = 0;
  let totalProcessed = 0;

  try {
    for (const tokenKey of COTIK_TOKEN_KEYS) {
      const token = process.env[tokenKey]?.trim();
      if (!token) {
        resultsByToken.push({
          tokenKey,
          status: null,
          shopCount: 0,
          error: "TOKEN_NOT_CONFIGURED",
        });
        continue;
      }

      let response: Response;
      let body: CotikShopResponse;
      try {
        response = await fetch(`${baseUrl}/analytic/shop`, {
          method: "GET",
          headers: {
            "al-token": token,
            Accept: "application/json",
            "User-Agent": "Tool-TTS/1.0",
          },
        });
        body = (await response.json()) as CotikShopResponse;
      } catch (fetchErr: any) {
        resultsByToken.push({
          tokenKey,
          status: null,
          shopCount: 0,
          error: fetchErr?.message || "NETWORK_ERROR",
        });
        continue;
      }

      const cotikShops = body?.data?.data ?? [];
      resultsByToken.push({
        tokenKey,
        status: response.status,
        shopCount: cotikShops.length,
      });

      for (const cotikShop of cotikShops) {
        totalProcessed++;
        const profileNo = extractProfileNo(cotikShop.note, cotikShop._id);
        const shopName = cotikShop.name ? cotikShop.name.trim() : `Shop #${profileNo}`;
        const region = cotikShop.region?.toUpperCase() === "US" ? "US" : "US";

        let targetShopId: string | null = null;
        const existingShop = await findShopByProfileNo(context.db, profileNo);

        if (existingShop) {
          targetShopId = existingShop.id;
          await updateShopDisplayName(context.db, profileNo, shopName);
          totalUpdated++;
        } else {
          const newShop = await createShop(context.db, {
            profileId: `cotik-${cotikShop._id}`,
            profileNo,
            displayName: shopName,
            region,
            locale: "en-US",
            currency: "USD",
            verificationStatus: "NOT_VERIFIED",
            eligibilityStatus: "ELIGIBLE",
            enabled: true,
          });
          targetShopId = newShop.id;
          totalCreated++;
        }

        if (targetShopId) {
          const existingBinding = await findEnabledShopProviderBinding(context.db, targetShopId, "COTIK");
          const existingCheckpoint = existingBinding?.checkpoint as Record<string, unknown> | null | undefined;
          const isValidOrdersCheckpoint =
            existingCheckpoint !== null &&
            typeof existingCheckpoint === "object" &&
            existingCheckpoint.schemaVersion === "cotik-orders-checkpoint.v1" &&
            typeof existingCheckpoint.lastUpdatedAtMs === "number";

          const rawHoldAmount = typeof cotikShop.sum_est_settlement_amount === "number"
            ? cotikShop.sum_est_settlement_amount
            : Number(cotikShop.sum_est_settlement_amount) || 0;
          const estimatedSettlement = typeof cotikShop.estimated_settlement === "string"
            ? cotikShop.estimated_settlement
            : null;

          await upsertShopProviderBinding(context.db, {
            shopId: targetShopId,
            provider: "COTIK",
            providerShopId: cotikShop._id,
            enabled: true,
            provenance: {
              source: "COTIK",
              capabilities: ["ORDERS", "SUPPLEMENTARY_FINANCE"],
              accountKey: tokenKey.replace("COTIK_TOKEN_", "").toLowerCase(),
              tokenKey,
              accountName: tokenKey.replace("COTIK_TOKEN_", ""),
              cotikShopId: cotikShop._id,
              sumEstSettlementAmount: rawHoldAmount,
              estimatedSettlement,
              onHoldBuckets: (existingBinding?.provenance as any)?.onHoldBuckets ?? null,
            },
            checkpoint: isValidOrdersCheckpoint ? existingCheckpoint : null,
          });
        }
      }

      // Small pacing delay between accounts
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return Response.json(
      {
        ok: true,
        message: `Đã làm mới danh sách: xử lý ${totalProcessed} cửa hàng từ 5 tài khoản COTIK (${totalUpdated} cập nhật, ${totalCreated} thêm mới).`,
        totalProcessed,
        totalUpdated,
        totalCreated,
        resultsByToken,
      },
      { headers: jsonHeaders() },
    );
  } catch (err: any) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "REFRESH_ERROR",
          message: err?.message || "Lỗi khi làm mới danh sách cửa hàng từ COTIK.",
        },
      },
      { status: 500, headers: jsonHeaders() },
    );
  } finally {
    await closeDatabase(context);
  }
}
