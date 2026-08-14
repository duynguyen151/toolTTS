import { pathToFileURL } from "node:url";

import { eq } from "drizzle-orm";

import { closeDatabase, createDatabase, type Database } from "./client.js";
import { readDatabaseConfig } from "./config.js";
import { insertFinancialSnapshot } from "./queries/finance.js";
import { upsertOrderBatch } from "./queries/orders.js";
import { shops, type ShopRow } from "./schema.js";

const DEMO_PROFILE_NO = "DEMO-001";
const DEMO_CAPTURED_AT = new Date("2026-08-01T00:00:00.000Z");

export interface DemoSeedResult {
  shop: ShopRow;
  orderCount: number;
  financialSnapshotCount: number;
}

async function getOrCreateDemoShop(db: Database): Promise<ShopRow> {
  const [created] = await db.insert(shops).values({
    profileId: "demo-sanitized-001",
    profileNo: DEMO_PROFILE_NO,
    displayName: "Sanitized Demo Shop",
    region: "US",
    locale: "en-US",
    currency: "USD",
    dataOrigin: "DEMO_SANITIZED",
    enabled: false,
    syncState: "DISABLED",
    pauseReason: "Sanitized demo data; never sync",
  }).onConflictDoNothing({ target: shops.profileNo }).returning();
  if (created) return created;

  const [existing] = await db.select().from(shops)
    .where(eq(shops.profileNo, DEMO_PROFILE_NO)).limit(1);
  if (!existing) throw new Error("Failed to create sanitized demo shop");
  if (
    existing.dataOrigin !== "DEMO_SANITIZED" ||
    existing.enabled ||
    existing.syncState !== "DISABLED"
  ) {
    throw new Error("DEMO-001 exists but is not a disabled sanitized demo shop");
  }
  return existing;
}

export async function seedSanitizedDemoData(db: Database): Promise<DemoSeedResult> {
  const shop = await getOrCreateDemoShop(db);
  const statuses = [
    ["DEMO-ORDER-001", "Awaiting shipment", "AWAITING_SHIPMENT", "900.0000"],
    ["DEMO-ORDER-002", "In transit", "IN_TRANSIT", "700.0000"],
    ["DEMO-ORDER-003", "Delivered", "DELIVERED", "650.0000"],
    ["DEMO-ORDER-004", "Completed", "COMPLETED", "500.0000"],
    ["DEMO-ORDER-005", "Canceled", "CANCELED", "250.0000"],
    ["DEMO-ORDER-006", "Unknown", "UNKNOWN", "100.0000"],
  ] as const;
  const orders = statuses.map(([sourceOrderId, sourceStatus, canonicalStatus, grandTotal], index) => {
    const observedAt = new Date(DEMO_CAPTURED_AT.getTime() + index * 60_000);
    return {
      shopId: shop.id,
      sourceOrderId,
      createdAt: observedAt,
      paidAt: observedAt,
      sourceUpdatedAt: observedAt,
      latestDeliveryAt: canonicalStatus === "DELIVERED" || canonicalStatus === "COMPLETED"
        ? observedAt
        : null,
      sourceStatus,
      sourceSubStatus: null,
      canonicalStatus,
      grandTotal,
      currency: "USD",
      trackingNumber: null,
      carrier: null,
      refundAmount: null,
      refundStatus: null,
      deliveryEligible: canonicalStatus !== "UNKNOWN",
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      sourceHash: `sanitized-demo-${sourceOrderId}`,
      sourceSchemaVersion: "sanitized-demo.v1",
      rawData: {},
    };
  });
  await upsertOrderBatch(db, orders);
  await insertFinancialSnapshot(db, {
    shopId: shop.id,
    capturedAt: DEMO_CAPTURED_AT,
    currency: "USD",
    availableBalance: "1800.0000",
    frozenBalance: "150.0000",
    totalBalance: "1950.0000",
    toSettleBalance: "900.0000",
    onHoldBalance: "1600.0000",
    reserveRatio: null,
    reserveDays: null,
    reserveLevel: null,
    snapshotHash: "sanitized-demo-finance-v1",
    sourceSchemaVersion: "sanitized-demo.v1",
    rawData: {},
  });
  return { shop, orderCount: orders.length, financialSnapshotCount: 1 };
}

async function main(): Promise<void> {
  const config = readDatabaseConfig();
  const context = createDatabase(config.databaseUrl);
  try {
    const result = await seedSanitizedDemoData(context.db);
    process.stdout.write(
      `Sanitized DEMO seed ready: ${result.shop.profileNo} (${result.orderCount} orders).\n`,
    );
  } finally {
    await closeDatabase(context);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
