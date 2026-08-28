import { readConsoleShops } from "../../lib/operations-console-read";
import { AdsPowerClient } from "@shop-health/seller-center/adspower";
import { ShopsListClient } from "./shops-client";

export const dynamic = "force-dynamic";

export default async function ShopsPage({
  searchParams,
}: {
  searchParams: Promise<{
    query?: string;
    syncState?: string;
    verificationState?: string;
    recommendation?: string;
    page?: string;
    pageSize?: string;
    sortBy?: string;
    sortOrder?: string;
  }>;
}) {
  const params = await searchParams;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const adsPower = new AdsPowerClient({
    ...(process.env.ADSPOWER_BASE_URL ? { baseUrl: process.env.ADSPOWER_BASE_URL } : {}),
    ...(process.env.ADSPOWER_API_KEY ? { apiKey: process.env.ADSPOWER_API_KEY } : {}),
  });

  const page = params.page ? parseInt(params.page, 10) : 1;
  const pageSize = params.pageSize ? parseInt(params.pageSize, 10) : 20;

  const result = await readConsoleShops(
    databaseUrl,
    {
      query: params.query,
      syncState: params.syncState,
      verificationState: params.verificationState,
      recommendation: params.recommendation,
      page,
      pageSize,
      sortBy: (params.sortBy as any) ?? "profileNo",
      sortOrder: (params.sortOrder as any) ?? "asc",
    },
    adsPower
  );

  return <ShopsListClient initialResult={result} initialParams={params} />;
}
