import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import { aiTaskConfigs } from "../schema.js";
import { appendAiTaskConfigRevision, getCurrentAiTaskConfig } from "./ai-task-configs.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const T0 = new Date("2026-08-25T00:00:00.000Z");

function reviewer(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "SHOP_HEALTH_REVIEWER",
    provider: "9router",
    baseUrl: "http://127.0.0.1:20128/v1",
    model: "oc/deepseek-v4-flash-free",
    parameters: {},
    secretRef: "TOOL_AI_API_KEY",
    enabled: true,
    status: "ENABLED",
    effectiveFrom: T0,
    ...overrides,
  } as const;
}

describeWithDatabase("AI task config PostgreSQL persistence", () => {
  let context: DatabaseContext;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
  });

  afterAll(async () => {
    if (context) await closeDatabase(context);
  });

  it("rejects malformed raw metadata, JSON, and non-finite timestamps", async () => {
    const invalid = [
      { taskId: "UNKNOWN", provider: "9router", baseUrl: "http://127.0.0.1:20128/v1", model: "oc/deepseek-v4-flash-free", parameters: {}, secretRef: "TOOL_AI_API_KEY", enabled: true, status: "ENABLED" },
      { taskId: "SHOP_HEALTH_REVIEWER", provider: "9router", baseUrl: "ftp://router.example.test/v1", model: "oc/deepseek-v4-flash-free", parameters: {}, secretRef: "TOOL_AI_API_KEY", enabled: true, status: "ENABLED" },
      { taskId: "SHOP_HEALTH_REVIEWER", provider: "9router", baseUrl: "http://127.0.0.1:20128/v1", model: "oc/deepseek-v4-flash-free", parameters: { temperature: 0 }, secretRef: "TOOL_AI_API_KEY", enabled: true, status: "ENABLED" },
      { taskId: "SHOP_HEALTH_REVIEWER", provider: "9router", baseUrl: "http://127.0.0.1:20128/v1", model: "oc/deepseek-v4-flash-free", parameters: {}, secretRef: "sk-live-secret", enabled: true, status: "ENABLED" },
      { taskId: "FINANCE_SPECIALIST", provider: "9router", baseUrl: "http://127.0.0.1:20128/v1", model: "oc/deepseek-v4-flash-free", parameters: {}, secretRef: "TOOL_AI_API_KEY", enabled: true, status: "ENABLED" },
    ];
    for (const row of invalid) {
      await expect(context.sql`
        insert into ai_task_configs (task_id, provider, base_url, model, parameters, secret_ref, enabled, status, effective_from)
        values (${row.taskId}, ${row.provider}, ${row.baseUrl}, ${row.model}, ${JSON.stringify(row.parameters)}::jsonb, ${row.secretRef}, ${row.enabled}, ${row.status}, ${T0.toISOString()}::timestamptz)
      `).rejects.toMatchObject({ constraint_name: expect.stringMatching(/^ai_task_configs_/) });
    }
    await expect(context.sql`
      insert into ai_task_configs (task_id, provider, base_url, model, parameters, secret_ref, enabled, status, effective_from)
      values ('SHOP_HEALTH_REVIEWER', '9router', 'http://127.0.0.1:20128/v1', 'oc/deepseek-v4-flash-free', '{}'::jsonb, 'TOOL_AI_API_KEY', true, 'ENABLED', 'infinity'::timestamptz)
    `).rejects.toMatchObject({ constraint_name: "ai_task_configs_effective_from_finite" });
  });

  it("appends immutable revisions and deterministically resolves the latest effective revision", async () => {
    const [first, second] = await Promise.all([
      appendAiTaskConfigRevision(context.db, reviewer({ model: "oc/deepseek-v4-flash-free" })),
      appendAiTaskConfigRevision(context.db, reviewer({ model: "oc/big-pickle" })),
    ]);
    const current = await getCurrentAiTaskConfig(context.db, { taskId: "SHOP_HEALTH_REVIEWER", effectiveAt: T0 });
    const winner = first.sequence > second.sequence ? first : second;
    expect(current).toMatchObject({ revisionId: winner.revisionId, model: winner.model });
    await expect(context.db.update(aiTaskConfigs).set({ enabled: false }).where(eq(aiTaskConfigs.revisionId, first.revisionId)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ message: "ai_task_configs are append-only" }) });
    await expect(context.db.delete(aiTaskConfigs).where(eq(aiTaskConfigs.revisionId, first.revisionId)))
      .rejects.toMatchObject({ cause: expect.objectContaining({ message: "ai_task_configs are append-only" }) });
  });

  it("preserves sequence values beyond the JavaScript safe integer boundary", async () => {
    await context.sql`
      select setval(
        pg_get_serial_sequence('ai_task_configs', 'sequence'),
        greatest((select coalesce(max(sequence), 0) from ai_task_configs), 9007199254740992)
      )
    `;
    const created = await appendAiTaskConfigRevision(context.db, reviewer({
      effectiveFrom: new Date("2030-01-01T00:00:00.000Z"),
    }));
    expect(typeof created.sequence).toBe("bigint");
    expect(created.sequence).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
  });

  it("keeps disabled future tasks out of reviewer resolution", async () => {
    const future = await appendAiTaskConfigRevision(context.db, reviewer({
      taskId: "FINANCE_SPECIALIST",
      enabled: false,
      status: "DISABLED",
    }));
    expect(future.enabled).toBe(false);
    expect(await getCurrentAiTaskConfig(context.db, { taskId: "SHOP_HEALTH_REVIEWER", effectiveAt: T0 }))
      .not.toBeNull();
  });
});
