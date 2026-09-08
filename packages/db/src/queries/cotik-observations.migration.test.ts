import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration0043Url = new URL("../../migrations/0043_strong_skaar.sql", import.meta.url);
const journalUrl = new URL("../../migrations/meta/_journal.json", import.meta.url);
const snapshotUrl = new URL("../../migrations/meta/0043_snapshot.json", import.meta.url);

describe("W21-T02 Observation & Order Tables Migration (0043)", () => {
  it("ships migration 0043 with observation, orders, and order_items tables", async () => {
    const sql = await readFile(migration0043Url, "utf8");

    expect(sql).toContain('CREATE TABLE "cotik_order_observations"');
    expect(sql).toContain('CREATE TABLE "cotik_orders"');
    expect(sql).toContain('CREATE TABLE "cotik_order_items"');

    // Constraints & unique indexes
    expect(sql).toContain('"cotik_order_observations_acc_shop_order_unique"');
    expect(sql).toContain('"cotik_orders_logical_shop_order_unique"');
    expect(sql).toContain('"cotik_order_items_quantity_positive"');
  });

  it("registers 0043 in drizzle journal with valid snapshot", async () => {
    const [journalRaw, snapshotRaw] = await Promise.all([
      readFile(journalUrl, "utf8"),
      readFile(snapshotUrl, "utf8")
    ]);

    const journal = JSON.parse(journalRaw) as { entries: Array<{ idx: number; tag: string }> };
    const snapshot = JSON.parse(snapshotRaw) as {
      tables: Record<string, unknown>;
    };

    expect(journal.entries).toContainEqual(
      expect.objectContaining({
        idx: 43,
        tag: "0043_strong_skaar"
      })
    );

    expect(snapshot.tables).toHaveProperty("public.cotik_order_observations");
    expect(snapshot.tables).toHaveProperty("public.cotik_orders");
    expect(snapshot.tables).toHaveProperty("public.cotik_order_items");
  });
});
