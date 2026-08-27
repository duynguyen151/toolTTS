import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0040_parallel_ironclad.sql", import.meta.url);
const snapshotUrl = new URL("../migrations/meta/0040_snapshot.json", import.meta.url);
const previousSnapshotUrl = new URL("../migrations/meta/0039_snapshot.json", import.meta.url);
const journalUrl = new URL("../migrations/meta/_journal.json", import.meta.url);

describe("W9-T01 auth-state migration", () => {
  it("adds actionable auth states forward without replacing legacy login state", async () => {
    const [migration, snapshotText, previousSnapshotText, journalText] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(snapshotUrl, "utf8"),
      readFile(previousSnapshotUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);
    const snapshot = JSON.parse(snapshotText) as {
      prevId: string;
      enums: Record<string, { values: string[] }>;
    };
    const previousSnapshot = JSON.parse(previousSnapshotText) as { id: string };
    const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };
    const states = snapshot.enums["public.adspower_profile_verification_state"]?.values;

    expect(migration).toContain("ADD VALUE 'CREDENTIALS_REQUIRED'");
    expect(migration).toContain("ADD VALUE 'AUTH_FAILED'");
    expect(states).toEqual(expect.arrayContaining([
      "LOGIN_REQUIRED",
      "CREDENTIALS_REQUIRED",
      "AUTH_FAILED",
      "HUMAN_ACTION_REQUIRED",
    ]));
    expect(snapshot.prevId).toBe(previousSnapshot.id);
    expect(journal.entries[40]).toEqual(expect.objectContaining({
      idx: 40,
      tag: "0040_parallel_ironclad",
    }));
  });
});
