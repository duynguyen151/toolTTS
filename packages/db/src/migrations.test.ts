import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const initialMigrationUrl = new URL("../migrations/0023_risk_policy_revisions.sql", import.meta.url);
const repairMigrationUrl = new URL("../migrations/0024_risk_policy_constraints.sql", import.meta.url);
const parityMigrationUrl = new URL("../migrations/0025_risk_policy_safe_integers.sql", import.meta.url);
const snapshotUrl = new URL("../migrations/meta/0023_snapshot.json", import.meta.url);

describe("W13-T02 migration", () => {
  it("defines immutable policy revisions, effective indexes, and nullable Case snapshots", async () => {
    const sql = await readFile(initialMigrationUrl, "utf8");

    expect(sql).toContain('CREATE TABLE "risk_policy_revisions"');
    expect(sql).toContain('"sequence" bigint GENERATED ALWAYS AS IDENTITY NOT NULL');
    expect(sql).toContain('"risk_policy_revisions_global_effective_idx"');
    expect(sql).toContain('"risk_policy_revisions_shop_effective_idx"');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "risk_policy_revisions"');
    expect(sql).toContain('ADD COLUMN "resolved_policy_snapshot" jsonb');
  });

  it("ships metadata for 0023 and repairs its raw SQL validation boundary", async () => {
    const [repairSql, paritySql, snapshot] = await Promise.all([
      readFile(repairMigrationUrl, "utf8"),
      readFile(parityMigrationUrl, "utf8"),
      readFile(snapshotUrl, "utf8"),
    ]);

    expect(JSON.parse(snapshot)).toMatchObject({ version: "7", dialect: "postgresql" });
    expect(repairSql).toContain('"risk_policy_revisions_effective_from_finite"');
    expect(repairSql).toContain('"risk_policy_revisions_payload_valid"');
    expect(repairSql).toContain(`"risk_policy_revisions"."payload" = '{"thresholds": {}, "caution": {}}'::jsonb`);
    expect(paritySql).toContain("9007199254740991");
  });
});
