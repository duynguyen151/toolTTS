import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../migrations/0033_refresh_settings.sql", import.meta.url);
const schemaUrl = new URL("../schema.ts", import.meta.url);
const journalUrl = new URL("../../migrations/meta/_journal.json", import.meta.url);

describe("W6-T01 refresh settings migration contract", () => {
  it("persists one global setting row and unique Bangkok wall-clock checkpoints", async () => {
    const [migrationSql, schemaText, journalText] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(schemaUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);
    const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };

    expect(migrationSql).toContain('CREATE TABLE "refresh_settings"');
    expect(migrationSql).toContain('CREATE TABLE "refresh_checkpoints"');
    expect(migrationSql).toContain('"refresh_settings_singleton"');
    expect(migrationSql).toContain('"refresh_settings_retry_offsets_valid"');
    expect(migrationSql).toContain('"refresh_checkpoints_local_time_valid"');
    expect(migrationSql).toContain('"refresh_checkpoints_local_time_unique"');
    expect(migrationSql).toContain("'08:00'");
    expect(migrationSql).toContain("'11:00'");
    expect(migrationSql).toContain("'17:00'");
    expect(migrationSql).toContain("'[0, 30, 120, 300, 600]'::jsonb");
    expect(migrationSql).toContain("HAVING count(*) > 1");
    expect(migrationSql).toContain("CASE WHEN jsonb_typeof(offsets)");
    expect(schemaText).toContain('"refresh_settings"');
    expect(schemaText).toContain('"refresh_checkpoints"');
    expect(journal.entries[33]).toEqual(expect.objectContaining({
      idx: 33,
      tag: "0033_refresh_settings",
    }));
  });
});
