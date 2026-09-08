import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration0042Url = new URL("../../migrations/0042_numerous_black_knight.sql", import.meta.url);
const journalUrl = new URL("../../migrations/meta/_journal.json", import.meta.url);
const snapshotUrl = new URL("../../migrations/meta/0042_snapshot.json", import.meta.url);
const migration0045Url = new URL("../../migrations/0045_omniscient_santa_claus.sql", import.meta.url);
const migration0046Url = new URL("../../migrations/0046_w21_persistence_corrective.sql", import.meta.url);
const unjournaledStatusMigrationUrl = new URL("../../migrations/0045_cotik_account_status_expand.sql", import.meta.url);

describe("W21-T01 Foundation Migration (0042)", () => {
  it("ships migration 0042 with all 7 multi-account & fulfillment foundation tables", async () => {
    const sql = await readFile(migration0042Url, "utf8");

    // All 7 tables created
    expect(sql).toContain('CREATE TABLE "cotik_accounts"');
    expect(sql).toContain('CREATE TABLE "cotik_account_secrets"');
    expect(sql).toContain('CREATE TABLE "cotik_logical_shops"');
    expect(sql).toContain('CREATE TABLE "cotik_account_shops"');
    expect(sql).toContain('CREATE TABLE "cotik_workflow_settings"');
    expect(sql).toContain('CREATE TABLE "cotik_provider_catalog"');
    expect(sql).toContain('CREATE TABLE "cotik_provider_rules"');

    // Constraints & checks
    expect(sql).toContain('"cotik_accounts_status_valid"');
    expect(sql).toContain('"cotik_accounts_display_name_not_blank"');
    expect(sql).toContain('"cotik_account_secrets_key_id_not_blank"');
    expect(sql).toContain('"cotik_logical_shops_ma_shop_noi_bo_not_blank"');
    expect(sql).toContain('"cotik_logical_shops_region_valid"');
    expect(sql).toContain('"cotik_account_shops_discovery_state_valid"');
    expect(sql).toContain('"cotik_provider_catalog_region_valid"');
    expect(sql).toContain('"cotik_provider_rules_region_valid"');

    // Unique indexes
    expect(sql).toContain('"cotik_account_secrets_account_id_unique"');
    expect(sql).toContain('"cotik_logical_shops_ma_shop_noi_bo_unique"');
    expect(sql).toContain('"cotik_account_shops_account_cotik_unique"');
    expect(sql).toContain('"cotik_account_shops_account_logical_unique"');
    expect(sql).toContain('"cotik_provider_catalog_provider_id_unique"');

    // Foreign keys
    expect(sql).toContain('"cotik_account_secrets_account_id_cotik_accounts_id_fk"');
    expect(sql).toContain('"cotik_account_shops_account_id_cotik_accounts_id_fk"');
    expect(sql).toContain('"cotik_account_shops_logical_shop_id_cotik_logical_shops_id_fk"');
    expect(sql).toContain('"cotik_provider_rules_provider_id_cotik_provider_catalog_provider_id_fk"');

    const providerCatalogUniqueIndexOffset = sql.indexOf(
      'CREATE UNIQUE INDEX "cotik_provider_catalog_provider_id_unique"'
    );
    const providerRuleForeignKeyOffset = sql.indexOf(
      'ALTER TABLE "cotik_provider_rules" ADD CONSTRAINT "cotik_provider_rules_provider_id_cotik_provider_catalog_provider_id_fk"'
    );

    expect(providerCatalogUniqueIndexOffset).toBeGreaterThanOrEqual(0);
    expect(providerRuleForeignKeyOffset).toBeGreaterThanOrEqual(0);
    expect(providerCatalogUniqueIndexOffset).toBeLessThan(providerRuleForeignKeyOffset);
  });

  it("registers 0042 in drizzle journal with valid snapshot", async () => {
    const [journalRaw, snapshotRaw] = await Promise.all([
      readFile(journalUrl, "utf8"),
      readFile(snapshotUrl, "utf8")
    ]);

    const journal = JSON.parse(journalRaw) as { entries: Array<{ idx: number; tag: string }> };
    const snapshot = JSON.parse(snapshotRaw) as {
      version: string;
      dialect: string;
      tables: Record<string, unknown>;
    };

    expect(journal.entries).toContainEqual(
      expect.objectContaining({
        idx: 42,
        tag: "0042_numerous_black_knight"
      })
    );

    expect(snapshot.dialect).toBe("postgresql");
    expect(snapshot.tables).toHaveProperty("public.cotik_accounts");
    expect(snapshot.tables).toHaveProperty("public.cotik_account_secrets");
    expect(snapshot.tables).toHaveProperty("public.cotik_logical_shops");
    expect(snapshot.tables).toHaveProperty("public.cotik_account_shops");
    expect(snapshot.tables).toHaveProperty("public.cotik_workflow_settings");
    expect(snapshot.tables).toHaveProperty("public.cotik_provider_catalog");
    expect(snapshot.tables).toHaveProperty("public.cotik_provider_rules");
  });

  it("consolidates workflow duplicates with both kill switches OFF before the unique index", async () => {
    const [sql, legacySql] = await Promise.all([
      readFile(migration0046Url, "utf8"),
      readFile(new URL("../../migrations/0045_omniscient_santa_claus.sql", import.meta.url), "utf8")
    ]);
    const disableOffset = sql.indexOf('UPDATE "cotik_workflow_settings"');
    const uniqueIndexOffset = sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS "cotik_workflow_settings_singleton_key_unique"');

    expect(disableOffset).toBeGreaterThanOrEqual(0);
    expect(sql).toContain('"cotik_sync_enabled" = false');
    expect(sql).toContain('"cotik_post_enabled" = false');
    expect(sql).toContain("row_number() OVER");
    expect(uniqueIndexOffset).toBeGreaterThan(disableOffset);
    expect(legacySql).not.toContain('CREATE UNIQUE INDEX "cotik_workflow_settings_singleton_key_unique"');
  });

  it("keeps account status expansion in the journaled 0045 migration", async () => {
    const [journalRaw, journaledSql] = await Promise.all([
      readFile(journalUrl, "utf8"),
      readFile(migration0045Url, "utf8")
    ]);
    const journal = JSON.parse(journalRaw) as { entries: Array<{ tag: string }> };

    expect(journal.entries).toContainEqual(expect.objectContaining({ tag: "0045_omniscient_santa_claus" }));
    expect(journal.entries).toContainEqual(expect.objectContaining({ tag: "0046_w21_persistence_corrective" }));
    expect(journal.entries).not.toContainEqual(expect.objectContaining({ tag: "0045_cotik_account_status_expand" }));
    expect(journaledSql).toContain("'UNKNOWN'");
    await expect(access(unjournaledStatusMigrationUrl)).rejects.toThrow();
  });

  it("backfills intent regions from logical shops and aborts unsafe legacy rows", async () => {
    const sql = await readFile(migration0046Url, "utf8");
    const initialSql = await readFile(new URL("../../migrations/0045_omniscient_santa_claus.sql", import.meta.url), "utf8");

    expect(sql).toContain('UPDATE "cotik_post_intents" intents');
    expect(sql).toContain('FROM "cotik_logical_shops" shops');
    expect(sql).toContain("RAISE EXCEPTION 'Cannot safely reconcile");
    expect(sql).toContain('intents."region" IS NULL');
    expect(sql).toContain("PENDING");
    expect(sql).toContain("IN_PROGRESS");
    expect(sql).toContain('ALTER COLUMN "region" DROP DEFAULT');
    expect(sql).toContain('"cotik_post_intents_region_check"');
    expect(sql).toContain('"cotik_post_intents_attempt_bound"');
    expect(sql).toContain('"attempt_count" >= 0');
    expect(sql).toContain('"max_attempts" >= 1');
    expect(sql).toContain('"max_attempts" <= 3');
    expect(initialSql).not.toContain("DEFAULT 'US'");
    expect(initialSql).toContain('ALTER COLUMN "region" SET NOT NULL');
  });

  it("records the completed root schema contract in the 0046 snapshot", async () => {
    const snapshot = JSON.parse(
      await readFile(new URL("../../migrations/meta/0046_snapshot.json", import.meta.url), "utf8")
    ) as {
      tables: Record<string, { columns: Record<string, { default?: string }>; checkConstraints: Record<string, { value: string }> }>;
    };
    const intents = snapshot.tables["public.cotik_post_intents"];

    if (!intents) {
      throw new Error("0046 snapshot is missing public.cotik_post_intents");
    }

    const regionColumn = intents.columns.region;
    const regionCheck = intents.checkConstraints.cotik_post_intents_region_check;
    const attemptCheck = intents.checkConstraints.cotik_post_intents_attempt_bound;
    if (!regionColumn || !regionCheck || !attemptCheck) {
      throw new Error("0046 snapshot is missing the completed Cotik intent contract");
    }

    expect(regionColumn.default).toBeUndefined();
    expect(regionCheck.value).toContain("'US', 'UK'");
    expect(attemptCheck.value).toContain(">= 0");
    expect(attemptCheck.value).toContain("<= 3");
  });
});
