import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../migrations/0036_observable_proxy_preflight.sql", import.meta.url);
const snapshotUrl = new URL("../../migrations/meta/0036_snapshot.json", import.meta.url);
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
});
