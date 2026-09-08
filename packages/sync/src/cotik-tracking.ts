import {
  createOrGetPostIntent, createTrackingCandidate, findCotikLogicalShopById,
  findCotikOrderById, listActiveCotikAccounts, listCotikAccountShopsByLogicalShop,
  listObservationsForOrder, listProviderCatalog, type Database, type DatabaseTransaction
} from "@shop-health/db";
import type { ProviderRegion } from "@shop-health/domain";

export interface StageCotikTrackingInput {
  logicalShopId: string;
  orderId: string;
  tracking: string;
  provider: string;
  region: ProviderRegion;
}

export type StageCotikTrackingResult =
  | { status: "STAGED"; candidateId: string; intentId: string }
  | { status: "PAUSED"; reason: string };

export type ResolvedCotikTrackingInput = StageCotikTrackingInput & { accountId: string; providerId: string };

function normalizeProviderValue(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function resolveExplicitProvider(
  provider: string,
  region: ProviderRegion,
  catalog: Awaited<ReturnType<typeof listProviderCatalog>>
): { providerId: string } | null {
  const requested = normalizeProviderValue(provider);
  const matches = catalog.filter((entry) => {
    if (entry.region !== region || entry.isActive !== true) return false;
    const providerId = normalizeProviderValue(entry.providerId);
    const carrierName = normalizeProviderValue(entry.carrierName);
    return requested === providerId || requested === carrierName;
  });
  return matches.length === 1 ? { providerId: matches[0]!.providerId } : null;
}

export async function resolveCotikTrackingInput(
  db: Database | DatabaseTransaction, input: StageCotikTrackingInput
): Promise<{ status: "RESOLVED"; input: ResolvedCotikTrackingInput } | { status: "PAUSED"; reason: string }> {
  const pause = (reason: string) => ({ status: "PAUSED" as const, reason });
  if (![input.logicalShopId, input.orderId, input.tracking, input.provider].every((value) =>
    typeof value === "string" && value.trim().length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value)
  ) || (input.region !== "US" && input.region !== "UK")) return pause("INVALID_INPUT");
  const clean = {
    ...input,
    logicalShopId: input.logicalShopId.trim(),
    orderId: input.orderId.trim(),
    tracking: input.tracking.trim(),
    provider: input.provider.trim()
  };
  const shop = await findCotikLogicalShopById(db, clean.logicalShopId);
  if (!shop || !/^\d+$/.test(shop.maShopNoiBo) || shop.region !== clean.region) return pause("SHOP_IDENTITY_OR_REGION_UNPROVEN");
  const order = await findCotikOrderById(db, shop.id, clean.orderId);
  if (!order) return pause("ORDER_NOT_OBSERVED_IN_SHOP");
  const [accounts, links, observations, catalog] = await Promise.all([
    listActiveCotikAccounts(db), listCotikAccountShopsByLogicalShop(db, shop.id),
    listObservationsForOrder(db, shop.id, clean.orderId),
    listProviderCatalog(db, clean.region)
  ]);
  const eligible = accounts.filter((account) => account.status === "ACTIVE" &&
    account.lastSeenAt !== null && Number.isFinite(account.lastSeenAt?.getTime()) &&
    links.some((link) => link.accountId === account.id && link.discoveryState === "DISCOVERED") &&
    observations.some((observation) => observation.accountId === account.id)
  ).sort((left, right) => right.lastSeenAt!.getTime() - left.lastSeenAt!.getTime() ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const account = eligible[0];
  if (!account) return pause("ACTIVE_DISCOVERED_ACCOUNT_UNPROVEN");
  const observation = observations.find((item) => item.accountId === account.id)!;
  if (!new Set(["AWAITING_SHIPMENT", "AWAITING_COLLECTION", "NEW"]).has(observation.orderStatus.trim().toUpperCase())) {
    return pause("ORDER_NOT_TRACKING_WRITE_ELIGIBLE");
  }
  if (observation.tracking?.trim() && observation.tracking.trim().toUpperCase() !== clean.tracking.toUpperCase())
    return pause("EXISTING_TRACKING_CONFLICT");
  const provider = resolveExplicitProvider(clean.provider, clean.region, catalog);
  if (!provider) return pause("EXPLICIT_PROVIDER_NOT_FOUND");
  return { status: "RESOLVED", input: { ...clean, accountId: account.id, providerId: provider.providerId } };
}

export async function stageCotikTracking(db: Database, input: StageCotikTrackingInput): Promise<StageCotikTrackingResult> {
  return db.transaction(async (transaction) => {
    const resolved = await resolveCotikTrackingInput(transaction, input);
    if (resolved.status === "PAUSED") return resolved;
    const candidate = await createTrackingCandidate(transaction, resolved.input);
    const intent = await createOrGetPostIntent(transaction, resolved.input);
    if (intent.status !== "PENDING") return { status: "PAUSED", reason: `INTENT_${intent.status}` };
    return { status: "STAGED", candidateId: candidate.id, intentId: intent.id };
  });
}
