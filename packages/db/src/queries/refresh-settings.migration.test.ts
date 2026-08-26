import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../migrations/0033_refresh_settings.sql", import.meta.url);
const schemaUrl = new URL("../schema.ts", import.meta.url);
const snapshotUrl = new URL("../../migrations/meta/0033_snapshot.json", import.meta.url);
const journalUrl = new URL("../../migrations/meta/_journal.json", import.meta.url);

describe("W6-T01 refresh settings migration contract", () => {
  it("persists one global setting row and unique Bangkok wall-clock checkpoints", async () => {
    const [migrationSql, schemaText, snapshotText, journalText] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(schemaUrl, "utf8"),
      readFile(snapshotUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);
    const snapshot = JSON.parse(snapshotText) as {
      tables: Record<string, { columns: Record<string, unknown>; checkConstraints: Record<string, { value: string }> }>;
    };
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
    expect(migrationSql).toContain('"retry_offsets_seconds" jsonb');
    expect(migrationSql).toContain("'[0, 30, 120, 300, 600]'::jsonb");
    expect(migrationSql).toContain("86400");
    expect(migrationSql).toContain("HAVING count(*) > 1");
    const normalizedMigrationSql = migrationSql.replace(/\s+/g, " ");
    expect(normalizedMigrationSql).toContain(
      "SELECT CASE WHEN jsonb_typeof(offsets) IS DISTINCT FROM 'array' THEN false ELSE CASE WHEN jsonb_array_length(offsets) NOT BETWEEN 1 AND 10 THEN false",
    );
    expect(normalizedMigrationSql).toContain(
      "WHERE CASE WHEN jsonb_typeof(value) IS DISTINCT FROM 'number' THEN true WHEN value #>> '{}' !~ '^(0|[1-9][0-9]*)$' THEN true WHEN length(value #>> '{}') > 5 THEN true ELSE CASE WHEN",
    );
    expect(normalizedMigrationSql).toContain("(value #>> '{}')::numeric BETWEEN 0 AND 86400");
    expect(migrationSql).toContain(
      'CHECK (public.refresh_retry_offsets_valid("refresh_settings"."retry_offsets_seconds"))',
    );
    expect(schemaText).toContain("sql`public.refresh_retry_offsets_valid(${table.retryOffsetsSeconds})`");
    expect(snapshot.tables["public.refresh_settings"]?.checkConstraints.refresh_settings_retry_offsets_valid?.value)
      .toBe('public.refresh_retry_offsets_valid("refresh_settings"."retry_offsets_seconds")');
    expect(migrationSql).not.toContain("retry_offsets_minutes");
    expect(schemaText).toContain('retryOffsetsSeconds: jsonb("retry_offsets_seconds")');
    expect(schemaText).toContain('"refresh_settings"');
    expect(schemaText).toContain('"refresh_checkpoints"');
    expect(snapshot.tables["public.refresh_settings"]?.columns).toHaveProperty("retry_offsets_seconds");
    expect(snapshot.tables["public.refresh_settings"]?.columns).not.toHaveProperty("retry_offsets_minutes");
    expect(snapshot.tables["public.refresh_settings"]?.checkConstraints.refresh_settings_retry_offsets_valid?.value)
      .toContain("retry_offsets_seconds");
    expect(journal.entries[33]).toEqual(expect.objectContaining({
      idx: 33,
      tag: "0033_refresh_settings",
    }));
  });
});
