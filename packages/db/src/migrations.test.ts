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
const financeCompletionMigrationUrl = new URL("../migrations/0030_finance_evidence_completion_lock.sql", import.meta.url);
const financeCompletionSnapshotUrl = new URL("../migrations/meta/0030_snapshot.json", import.meta.url);
const financeHealthMigrationUrl = new URL("../migrations/0031_finance_health_reconciliation.sql", import.meta.url);
const financeHealthSnapshotUrl = new URL("../migrations/meta/0031_snapshot.json", import.meta.url);
const financePreviousSnapshotUrl = new URL("../migrations/meta/0028_snapshot.json", import.meta.url);
const aiTaskMigrationUrl = new URL("../migrations/0032_pretty_black_panther.sql", import.meta.url);
const aiTaskSnapshotUrl = new URL("../migrations/meta/0032_snapshot.json", import.meta.url);
const aiTaskPreviousSnapshotUrl = new URL("../migrations/meta/0031_snapshot.json", import.meta.url);
const schemaUrl = new URL("./schema.ts", import.meta.url);
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

  it("repairs signed line evidence and serializes completion in forward 0030", async () => {
    const [sql, snapshotText, previousSnapshotText, journalText] = await Promise.all([
      readFile(financeCompletionMigrationUrl, "utf8"),
      readFile(financeCompletionSnapshotUrl, "utf8"),
      readFile(financeRepairSnapshotUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);
    const snapshot = JSON.parse(snapshotText) as {
      prevId: string;
      tables: Record<string, { checkConstraints: Record<string, unknown> }>;
    };
    const previousSnapshot = JSON.parse(previousSnapshotText) as { id: string };
    const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };

    expect(sql).toContain('DROP CONSTRAINT "finance_capture_items_expected_nonnegative"');
    expect(sql).toContain("FOR UPDATE OF sr");
    expect(sql).toContain("OLD.status <> 'RUNNING'");
    expect(snapshot.prevId).toBe(previousSnapshot.id);
    expect(snapshot.tables["public.finance_capture_items"]?.checkConstraints)
      .not.toHaveProperty("finance_capture_items_expected_nonnegative");
    expect(journal.entries[30]).toEqual(expect.objectContaining({
      idx: 30,
      tag: "0030_finance_evidence_completion_lock",
    }));
  });
});

describe("W5-T02 Finance health migration", () => {
  it("persists reconciliation without fabricating legacy facts", async () => {
    const [sql, snapshotText, previousSnapshotText, journalText] = await Promise.all([
      readFile(financeHealthMigrationUrl, "utf8"),
      readFile(financeHealthSnapshotUrl, "utf8"),
      readFile(financeCompletionSnapshotUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);
    const snapshot = JSON.parse(snapshotText) as {
      prevId: string;
      tables: Record<string, { columns: Record<string, unknown> }>;
    };
    const previousSnapshot = JSON.parse(previousSnapshotText) as { id: string };
    const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };

    expect(sql).toContain('ADD COLUMN "source_reconciled" boolean');
    expect(sql).toContain('DROP TRIGGER "sync_runs_finance_evidence_authorized"');
    expect(sql).toContain('WHERE EXISTS (\n\tSELECT 1 FROM "finance_captures"');
    expect(sql).not.toContain('UPDATE "sync_runs" AS "sr"\nSET "source_reconciled" = false');
    expect(sql).toContain('NEW.source_reconciled IS DISTINCT FROM true');
    expect(sql).toContain('CREATE TRIGGER "sync_runs_finance_evidence_authorized"');
    expect(snapshot.prevId).toBe(previousSnapshot.id);
    expect(snapshot.tables["public.sync_runs"]?.columns).toHaveProperty("source_reconciled");
    expect(journal.entries[31]).toEqual(expect.objectContaining({
      idx: 31,
      tag: "0031_finance_health_reconciliation",
    }));
  });
});

describe("W14-T01 AI task migration", () => {
  it("accepts port 65535 but rejects port 99999 in migration, schema, and snapshot constraints", async () => {
    const [migrationSql, snapshotText, previousSnapshotText, schemaText, journalText] = await Promise.all([
      readFile(aiTaskMigrationUrl, "utf8"),
      readFile(aiTaskSnapshotUrl, "utf8"),
      readFile(aiTaskPreviousSnapshotUrl, "utf8"),
      readFile(schemaUrl, "utf8"),
      readFile(journalUrl, "utf8"),
    ]);
    const snapshot = JSON.parse(snapshotText) as {
      prevId: string;
      tables: Record<string, { checkConstraints: Record<string, { value: string }> }>;
    };
    const previousSnapshot = JSON.parse(previousSnapshotText) as { id: string };
    const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };
    const constraint = snapshot.tables["public.ai_task_configs"]?.checkConstraints.ai_task_configs_base_url_valid?.value;

    const portPattern = /^(?:[0-9]{1,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/;
    expect(portPattern.test("65535")).toBe(true);
    expect(portPattern.test("99999")).toBe(false);
    for (const source of [migrationSql, schemaText, constraint]) {
      expect(source).toContain("6553[0-5]");
      expect(source).not.toContain(":[0-9]{1,5}");
    }
    expect(snapshot.prevId).toBe(previousSnapshot.id);
    expect(journal.entries[32]).toEqual(expect.objectContaining({
      idx: 32,
      tag: "0032_pretty_black_panther",
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
