import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const initialMigrationUrl = new URL("../migrations/0023_risk_policy_revisions.sql", import.meta.url);
const repairMigrationUrl = new URL("../migrations/0024_risk_policy_constraints.sql", import.meta.url);
const parityMigrationUrl = new URL("../migrations/0025_risk_policy_safe_integers.sql", import.meta.url);
const slowSellMigrationUrl = new URL("../migrations/0026_slow_sell_planned_methods.sql", import.meta.url);
const notesRepairMigrationUrl = new URL("../migrations/0027_meaningful_ba_notes.sql", import.meta.url);
const snapshotUrl = new URL("../migrations/meta/0023_snapshot.json", import.meta.url);
const slowSellSnapshotUrl = new URL("../migrations/meta/0026_snapshot.json", import.meta.url);
const notesRepairSnapshotUrl = new URL("../migrations/meta/0027_snapshot.json", import.meta.url);
const financeRepairMigrationUrl = new URL("../migrations/0029_finance_evidence_authorization.sql", import.meta.url);
const financeRepairSnapshotUrl = new URL("../migrations/meta/0029_snapshot.json", import.meta.url);
const financePreviousSnapshotUrl = new URL("../migrations/meta/0028_snapshot.json", import.meta.url);
const previousSnapshotUrl = new URL("../migrations/meta/0025_snapshot.json", import.meta.url);
const journalUrl = new URL("../migrations/meta/_journal.json", import.meta.url);

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

describe("W5-T01 Finance repair migration", () => {
  it("ships forward 0029 identity, append-only, authorization, poison-value, and lineage enforcement", async () => {
    const [sql, snapshotText, previousSnapshotText, journalText] = await Promise.all([
      readFile(financeRepairMigrationUrl, "utf8"),
      readFile(financeRepairSnapshotUrl, "utf8"),
      readFile(financePreviousSnapshotUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);
    const snapshot = JSON.parse(snapshotText) as {
      prevId: string;
      tables: Record<string, { columns: Record<string, unknown>; checkConstraints: Record<string, unknown> }>;
    };
    const previousSnapshot = JSON.parse(previousSnapshotText) as { id: string };
    const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };

    expect(sql).toContain('ADD COLUMN "source_statement_id" text');
    expect(sql).toContain('ADD COLUMN "source_statement_version" text');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "financial_snapshots"');
    expect(sql).toContain('BEFORE INSERT ON "finance_captures"');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "sync_runs"');
    expect(sql).toContain('DROP INDEX IF EXISTS "finance_captures_shop_captured_idx"');
    expect(sql).toContain("NOT VALID");
    expect(snapshot.prevId).toBe(previousSnapshot.id);
    expect(snapshot.tables["public.finance_capture_items"]?.columns).toMatchObject({
      source_statement_id: expect.anything(),
      source_statement_version: expect.anything(),
    });
    expect(journal.entries[29]).toEqual(expect.objectContaining({
      idx: 29,
      tag: "0029_finance_evidence_authorization",
    }));
  });
});

describe("W16-T01 migration", () => {
  it("adds SLOW_SELL and nullable planned-method JSONB constraints after 0025", async () => {
    const [sql, snapshotText, previousSnapshotText, journalText] = await Promise.all([
      readFile(slowSellMigrationUrl, "utf8"),
      readFile(slowSellSnapshotUrl, "utf8"),
      readFile(previousSnapshotUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);
    const snapshot = JSON.parse(snapshotText) as {
      prevId: string;
      tables: Record<string, { columns: Record<string, unknown>; checkConstraints: Record<string, unknown> }>;
      enums: Record<string, { values: string[] }>;
    };
    const previousSnapshot = JSON.parse(previousSnapshotText) as { id: string };
    const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };

    expect(sql).toContain(`ALTER TYPE "public"."ba_decision" ADD VALUE 'SLOW_SELL'`);
    expect(sql).toContain('ADD COLUMN "planned_methods" jsonb');
    expect(sql).toContain('"ba_decisions_planned_methods_valid"');
    expect(sql).toContain('"ba_decisions_planned_method_other_requires_notes"');
    expect(snapshot.prevId).toBe(previousSnapshot.id);
    expect(snapshot.enums["public.ba_decision"]?.values).toEqual([
      "SCALE", "CONTINUE", "WATCH", "PAUSE", "SLOW_SELL",
    ]);
    expect(snapshot.tables["public.ba_decisions"]?.columns).toHaveProperty("planned_methods");
    expect(snapshot.tables["public.ba_decisions"]?.checkConstraints).toMatchObject({
      ba_decisions_planned_methods_valid: expect.anything(),
      ba_decisions_planned_method_other_requires_notes: expect.anything(),
    });
    expect(journal.entries[26]).toEqual(expect.objectContaining({
      idx: 26,
      tag: "0026_slow_sell_planned_methods",
    }));
  });

  it("repairs meaningful BA note checks in forward 0027 metadata", async () => {
    const [sql, snapshotText, previousSnapshotText, journalText] = await Promise.all([
      readFile(notesRepairMigrationUrl, "utf8"),
      readFile(notesRepairSnapshotUrl, "utf8"),
      readFile(slowSellSnapshotUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);
    const snapshot = JSON.parse(snapshotText) as {
      prevId: string;
      tables: Record<string, { checkConstraints: Record<string, { value: string }> }>;
    };
    const previousSnapshot = JSON.parse(previousSnapshotText) as { id: string };
    const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };
    const checks = snapshot.tables["public.ba_decisions"]?.checkConstraints;

    expect(sql).toContain('DROP CONSTRAINT "ba_decisions_note_not_blank"');
    expect(sql).toContain('DROP CONSTRAINT "ba_decisions_notes_not_blank"');
    expect(sql).toContain('DROP CONSTRAINT "ba_decisions_planned_method_other_requires_notes"');
    expect(sql).toContain('DROP CONSTRAINT "ba_decisions_other_requires_notes"');
    expect(sql).toContain("regexp_replace");
    expect(sql).toContain("[[:space:][:cntrl:]\\u200B\\uFEFF]");
    expect(snapshot.prevId).toBe(previousSnapshot.id);
    expect(checks?.ba_decisions_note_not_blank?.value).toContain("regexp_replace");
    expect(checks?.ba_decisions_notes_not_blank?.value).toContain("regexp_replace");
    expect(checks?.ba_decisions_planned_method_other_requires_notes?.value).toContain("regexp_replace");
    expect(checks?.ba_decisions_other_requires_notes?.value).toContain("LEGACY_UNATTRIBUTED");
    expect(journal.entries[27]).toEqual(expect.objectContaining({
      idx: 27,
      tag: "0027_meaningful_ba_notes",
    }));
  });
});
