import { jsonHeaders } from "../../../lib/server/operations/request.js";
import { readConsoleShops } from "../../../lib/operations-console-read.js";
import { AdsPowerClient } from "@shop-health/seller-center/adspower";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const url = new URL(request.url);
  const query = url.searchParams.get("query") ?? undefined;
  const syncState = url.searchParams.get("syncState") ?? undefined;
  const verificationState = url.searchParams.get("verificationState") ?? undefined;
  const recommendation = url.searchParams.get("recommendation") ?? undefined;
  const page = url.searchParams.get("page") ? parseInt(url.searchParams.get("page")!, 10) : 1;
  const pageSize = url.searchParams.get("pageSize") ? parseInt(url.searchParams.get("pageSize")!, 10) : 20;
  const sortBy = (url.searchParams.get("sortBy") as any) ?? "profileNo";
  const sortOrder = (url.searchParams.get("sortOrder") as any) ?? "asc";

  const adsPower = new AdsPowerClient({
    ...(process.env.ADSPOWER_BASE_URL ? { baseUrl: process.env.ADSPOWER_BASE_URL } : {}),
    ...(process.env.ADSPOWER_API_KEY ? { apiKey: process.env.ADSPOWER_API_KEY } : {}),
  });

  try {
    const result = await readConsoleShops(
      databaseUrl,
      {
        query,
        syncState,
        verificationState,
        recommendation,
        page,
        pageSize,
        sortBy,
        sortOrder,
      },
      adsPower,
    );

    return Response.json(
      {
        ok: true,
        data: result,
      },
      { headers: jsonHeaders() },
    );
  } catch (err: any) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "UNEXPECTED_ERROR",
          message: err?.message || "Không thể tải danh sách cửa hàng.",
        },
      },
      { status: 500, headers: jsonHeaders() },
    );
  }
}
