import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0023_risk_policy_revisions.sql", import.meta.url);

describe("W13-T02 migration", () => {
  it("defines immutable policy revisions, effective indexes, and nullable Case snapshots", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE TABLE "risk_policy_revisions"');
    expect(sql).toContain('"sequence" bigint GENERATED ALWAYS AS IDENTITY NOT NULL');
    expect(sql).toContain('"risk_policy_revisions_global_effective_idx"');
    expect(sql).toContain('"risk_policy_revisions_shop_effective_idx"');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "risk_policy_revisions"');
    expect(sql).toContain('ADD COLUMN "resolved_policy_snapshot" jsonb');
  });
});
