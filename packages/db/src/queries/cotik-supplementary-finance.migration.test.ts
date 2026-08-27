import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../migrations/0039_cotik_supplementary_finance.sql", import.meta.url);
const snapshotUrl = new URL("../../migrations/meta/0039_snapshot.json", import.meta.url);
const previousSnapshotUrl = new URL("../../migrations/meta/0038_snapshot.json", import.meta.url);
const journalUrl = new URL("../../migrations/meta/_journal.json", import.meta.url);

describe("W4-T01 supplementary COTIK Finance migration", () => {
  it("adds isolated provider-ID tables, indexes, and forward snapshot lineage without Official-On-Hold columns", async () => {
    const [sql, snapshotText, previousSnapshotText, journalText] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(snapshotUrl, "utf8"),
      readFile(previousSnapshotUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);
    const snapshot = JSON.parse(snapshotText) as {
      prevId: string;
      tables: Record<string, { columns: Record<string, unknown>; indexes: Record<string, unknown> }>;
    };
    const previousSnapshot = JSON.parse(previousSnapshotText) as { id: string };
    const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };

    expect(sql).toContain('CREATE TABLE "cotik_supplementary_statements"');
    expect(sql).toContain('CREATE TABLE "cotik_supplementary_payments"');
    expect(sql).toContain('"cotik_supplementary_statements_shop_provider_statement_unique"');
    expect(sql).toContain('"cotik_supplementary_payments_shop_provider_payment_unique"');
    expect(sql).toContain('"cotik_supplementary_statements_shop_payment_idx"');
    expect(sql).not.toMatch(/official_on_hold|finance_capture|settlement_record/i);
    expect(snapshot.prevId).toBe(previousSnapshot.id);
    expect(snapshot.tables["public.cotik_supplementary_statements"]?.columns).toMatchObject({
      provider_statement_id: expect.anything(),
      provider_payment_id: expect.anything(),
    });
    expect(snapshot.tables["public.cotik_supplementary_payments"]?.columns).toHaveProperty("provider_payment_id");
    expect(journal.entries[39]).toEqual(expect.objectContaining({
      idx: 39,
      tag: "0039_cotik_supplementary_finance",
    }));
  });
});
