import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../migrations/0041_objective_shop_health_history.sql", import.meta.url);
const snapshotUrl = new URL("../../migrations/meta/0041_snapshot.json", import.meta.url);
const previousSnapshotUrl = new URL("../../migrations/meta/0040_snapshot.json", import.meta.url);
const journalUrl = new URL("../../migrations/meta/_journal.json", import.meta.url);

describe("W17-T01 objective shop-health history migration", () => {
  it("adds append-only provenance to the existing KPI snapshot seam", async () => {
    const [migration, snapshotText, previousSnapshotText, journalText] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(snapshotUrl, "utf8"),
      readFile(previousSnapshotUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);
    const snapshot = JSON.parse(snapshotText) as {
      prevId: string;
      tables: Record<string, { columns: Record<string, unknown> }>;
    };
    const previousSnapshot = JSON.parse(previousSnapshotText) as { id: string };
    const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };

    expect(migration).toContain('ADD COLUMN "profile_id" text');
    expect(migration).toContain('ADD COLUMN "provider_provenance" jsonb');
    expect(migration).toContain('ADD COLUMN "policy_provenance" jsonb');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "kpi_snapshots"');
    expect(snapshot.prevId).toBe(previousSnapshot.id);
    expect(snapshot.tables["public.kpi_snapshots"]?.columns).toMatchObject({
      profile_id: expect.anything(),
      profile_no: expect.anything(),
      provider_provenance: expect.anything(),
      policy_provenance: expect.anything(),
    });
    expect(journal.entries[41]).toEqual(expect.objectContaining({
      idx: 41,
      tag: "0041_objective_shop_health_history",
    }));
  });
});
