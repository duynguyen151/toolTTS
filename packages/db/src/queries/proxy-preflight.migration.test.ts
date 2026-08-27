import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../migrations/0036_observable_proxy_preflight.sql", import.meta.url);
const repairMigrationUrl = new URL("../../migrations/0037_proxy_preflight_constraints.sql", import.meta.url);
const snapshotUrl = new URL("../../migrations/meta/0036_snapshot.json", import.meta.url);
const repairSnapshotUrl = new URL("../../migrations/meta/0037_snapshot.json", import.meta.url);
const journalUrl = new URL("../../migrations/meta/_journal.json", import.meta.url);

describe("W7-T02 proxy preflight persistence migration", () => {
  it("stores only typed preflight metadata alongside refresh attempts", async () => {
    const [migrationSql, snapshotText, journalText] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(snapshotUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);
    const snapshot = JSON.parse(snapshotText) as {
      tables: Record<string, { columns: Record<string, unknown>; checkConstraints: Record<string, unknown> }>;
    };

    expect(migrationSql).toContain('ADD COLUMN "proxy_preflight" jsonb');
    expect(migrationSql).toContain('"refresh_checkpoint_attempts_proxy_preflight_valid"');
    expect(migrationSql).toContain("'HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN'");
    expect(migrationSql).not.toContain("PROXY_EXPIRED");
    expect(snapshot.tables["public.refresh_checkpoint_attempts"]?.columns).toHaveProperty("proxy_preflight");
    expect(snapshot.tables["public.refresh_checkpoint_attempts"]?.checkConstraints)
      .toHaveProperty("refresh_checkpoint_attempts_proxy_preflight_valid");
    expect(JSON.parse(journalText).entries).toContainEqual(expect.objectContaining({
      tag: "0036_observable_proxy_preflight",
    }));
  });

  it("hardens the persisted JSONB contract in a forward migration", async () => {
    const [migrationSql, snapshotText, previousSnapshotText, journalText] = await Promise.all([
      readFile(repairMigrationUrl, "utf8"),
      readFile(repairSnapshotUrl, "utf8"),
      readFile(snapshotUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);
    const snapshot = JSON.parse(snapshotText) as {
      prevId: string;
      tables: Record<string, { checkConstraints: Record<string, { value: string }> }>;
    };
    const previousSnapshot = JSON.parse(previousSnapshotText) as { id: string };
    const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };
    const constraint = snapshot.tables["public.refresh_checkpoint_attempts"]
      ?.checkConstraints.refresh_checkpoint_attempts_proxy_preflight_valid?.value;

    expect(migrationSql).toContain('DROP CONSTRAINT "refresh_checkpoint_attempts_proxy_preflight_valid"');
    expect(migrationSql).toContain('ADD CONSTRAINT "refresh_checkpoint_attempts_proxy_preflight_valid"');
    for (const source of [migrationSql, constraint]) {
      expect(source).toContain("jsonb_object_length");
      expect(source).toContain("jsonb_typeof");
      expect(source).toContain("between 0 and 10000");
      expect(source).toContain("= 88");
      expect(source).toContain("= 99");
      expect(source).toContain("OBSERVATION_UNAVAILABLE");
      expect(source).toContain("OBSERVED_SLOW");
      expect(source).toContain("NETWORK_UNAVAILABLE");
    }
    expect(snapshot.prevId).toBe(previousSnapshot.id);
    expect(journal.entries[37]).toEqual(expect.objectContaining({
      idx: 37,
      tag: "0037_proxy_preflight_constraints",
    }));
  });
});
