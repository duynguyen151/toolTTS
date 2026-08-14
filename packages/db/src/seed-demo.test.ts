import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createDatabase, type DatabaseContext } from "./client.js";
import { migrateDatabase } from "./migrations.js";
import { seedSanitizedDemoData } from "./seed-demo.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

async function cleanupDemoShop(context: DatabaseContext): Promise<void> {
  await context.sql`delete from decision_executions where decision_case_id in (
    select decision_cases.id from decision_cases
    inner join shops on shops.id = decision_cases.shop_id
    where shops.profile_no = 'DEMO-001'
  )`;
  await context.sql`delete from ai_decisions where decision_case_id in (
    select decision_cases.id from decision_cases
    inner join shops on shops.id = decision_cases.shop_id
    where shops.profile_no = 'DEMO-001'
  )`;
  await context.sql`delete from ba_decisions where decision_case_id in (
    select decision_cases.id from decision_cases
    inner join shops on shops.id = decision_cases.shop_id
    where shops.profile_no = 'DEMO-001'
  )`;
  await context.sql`delete from decision_cases where shop_id in (select id from shops where profile_no = 'DEMO-001')`;
  await context.sql`delete from financial_snapshots where shop_id in (select id from shops where profile_no = 'DEMO-001')`;
  await context.sql`delete from orders where shop_id in (select id from shops where profile_no = 'DEMO-001')`;
  await context.sql`delete from shops where profile_no = 'DEMO-001'`;
}

describeWithDatabase("sanitized demo seed", () => {
  let context: DatabaseContext;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
    await cleanupDemoShop(context);
  });

  afterAll(async () => {
    try {
      await cleanupDemoShop(context);
    } finally {
      await closeDatabase(context);
    }
  });

  it("is idempotent and marks every seeded row as sanitized DEMO data", async () => {
    const first = await seedSanitizedDemoData(context.db);
    const second = await seedSanitizedDemoData(context.db);

    expect(second.shop.id).toBe(first.shop.id);
    expect(second.shop).toMatchObject({
      profileNo: "DEMO-001",
      dataOrigin: "DEMO_SANITIZED",
      enabled: false,
      syncState: "DISABLED",
    });
    const [counts] = await context.sql<[{ order_count: number; snapshot_count: number }]>`
      select
        (select count(*)::int from orders where shop_id = ${first.shop.id}) as order_count,
        (select count(*)::int from financial_snapshots where shop_id = ${first.shop.id}) as snapshot_count
    `;
    expect(counts).toEqual({ order_count: 6, snapshot_count: 1 });
    const rawRows = await context.sql<Array<{ raw_data: unknown }>>`
      select raw_data from orders where shop_id = ${first.shop.id}
    `;
    expect(rawRows.every(({ raw_data }) => JSON.stringify(raw_data) === "{}")).toBe(true);
  });
});
