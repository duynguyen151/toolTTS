import { notFound } from "next/navigation";
import { readConsoleShopDetail } from "../../../lib/operations-console-read";
import { AdsPowerClient } from "@shop-health/seller-center/adspower";
import { ShopDetailClient } from "./shop-detail-client";

export const dynamic = "force-dynamic";

export default async function ShopDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ profileNo: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { profileNo } = await params;
  const { tab } = await searchParams;
  const databaseUrl = process.env.DATABASE_URL?.trim();

  const adsPower = new AdsPowerClient({
    ...(process.env.ADSPOWER_BASE_URL ? { baseUrl: process.env.ADSPOWER_BASE_URL } : {}),
    ...(process.env.ADSPOWER_API_KEY ? { apiKey: process.env.ADSPOWER_API_KEY } : {}),
  });

  const detail = await readConsoleShopDetail(databaseUrl, profileNo, adsPower);
  if (!detail) {
    notFound();
  }

  return <ShopDetailClient initialDetail={detail} initialTab={(tab as any) ?? "overview"} />;
}
