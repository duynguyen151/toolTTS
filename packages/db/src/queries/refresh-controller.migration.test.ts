import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../migrations/0034_refresh_checkpoint_controller.sql", import.meta.url);
const snapshotUrl = new URL("../../migrations/meta/0034_snapshot.json", import.meta.url);
const journalUrl = new URL("../../migrations/meta/_journal.json", import.meta.url);

describe("W6-T02 refresh checkpoint controller migration contract", () => {
  it("creates durable cycle and attempt ownership without new seed rows", async () => {
    const [migrationSql, snapshotText, journalText] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(snapshotUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);

    expect(migrationSql).toContain('CREATE TYPE "public"."refresh_checkpoint_run_status"');
    expect(migrationSql).toContain('CREATE TABLE "refresh_checkpoint_runs"');
    expect(migrationSql).toContain('CREATE TABLE "refresh_checkpoint_attempts"');
    expect(migrationSql).toContain('"refresh_checkpoint_runs_shop_date_checkpoint_unique"');
    expect(migrationSql).toContain('"refresh_checkpoint_attempts_run_number_unique"');
    expect(migrationSql).toContain('"refresh_checkpoint_runs_due_idx"');
    expect(migrationSql).toContain('"refresh_checkpoint_runs_status_consistent"');
    expect(migrationSql).toContain("retry_offsets_seconds");
    expect(migrationSql).not.toMatch(/insert\s+into\s+"?refresh_checkpoint_(?:runs|attempts)/i);
    expect(snapshotText).toContain('"public.refresh_checkpoint_runs"');
    expect(snapshotText).toContain('"public.refresh_checkpoint_attempts"');
    expect(JSON.parse(journalText).entries).toContainEqual(expect.objectContaining({
      tag: "0034_refresh_checkpoint_controller",
    }));
  });
});
