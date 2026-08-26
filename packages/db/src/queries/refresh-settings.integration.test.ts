import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import {
  addRefreshCheckpoint,
  deleteRefreshCheckpoint,
  getCurrentRefreshSettings,
  setAutoRefreshEnabled,
  setRefreshCheckpointEnabled,
  setRefreshRetryOffsets,
  updateRefreshCheckpoint,
} from "./refresh-settings.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("refresh settings PostgreSQL persistence", () => {
  let context: DatabaseContext;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
    await context.sql`delete from refresh_checkpoints`;
    await context.sql`delete from refresh_settings`;
    await context.sql`
      insert into refresh_settings (singleton_id)
      values (1)
    `;
    await context.sql`
      insert into refresh_checkpoints (local_time)
      values ('08:00'), ('11:00'), ('17:00')
    `;
  });

  afterAll(async () => {
    if (context) await closeDatabase(context);
  });

  it("seeds the mutable V1 defaults in chronological Bangkok local time order", async () => {
    const current = await getCurrentRefreshSettings(context.db);

    expect(current).toMatchObject({
      autoRefreshEnabled: true,
      retryOffsetsSeconds: [0, 30, 120, 300, 600],
      timeZone: "Asia/Bangkok",
    });
    expect(current.checkpoints.map((checkpoint) => checkpoint.localTime)).toEqual(["08:00", "11:00", "17:00"]);
  });

  it("reads current changes without retaining an in-process settings cache", async () => {
    await setAutoRefreshEnabled(context.db, { enabled: false });
    await setRefreshRetryOffsets(context.db, { retryOffsetsSeconds: [0, 5, 60] });

    await expect(getCurrentRefreshSettings(context.db)).resolves.toMatchObject({
      autoRefreshEnabled: false,
      retryOffsetsSeconds: [0, 5, 60],
    });
  });

  it("creates, edits, enables, and deletes custom checkpoints with deterministic not-found results", async () => {
    const created = await addRefreshCheckpoint(context.db, { localTime: "09:17" });
    const disabled = await setRefreshCheckpointEnabled(context.db, { checkpointId: created.id, enabled: false });
    const updated = await updateRefreshCheckpoint(context.db, { checkpointId: created.id, localTime: "06:42" });

    expect(disabled).toMatchObject({ id: created.id, enabled: false });
    expect(updated).toMatchObject({ id: created.id, localTime: "06:42", enabled: false });
    expect((await getCurrentRefreshSettings(context.db)).checkpoints.map((checkpoint) => checkpoint.localTime))
      .toEqual(["06:42", "08:00", "11:00", "17:00"]);
    await expect(deleteRefreshCheckpoint(context.db, { checkpointId: created.id })).resolves.toBe(true);
    await expect(deleteRefreshCheckpoint(context.db, { checkpointId: created.id })).resolves.toBe(false);
    await expect(updateRefreshCheckpoint(context.db, { checkpointId: created.id, localTime: "07:00" })).resolves.toBeNull();
    await expect(setRefreshCheckpointEnabled(context.db, { checkpointId: created.id, enabled: true })).resolves.toBeNull();
  });

  it("rejects duplicate local times regardless of enabled state", async () => {
    const created = await addRefreshCheckpoint(context.db, { localTime: "10:22", enabled: false });
    await expect(addRefreshCheckpoint(context.db, { localTime: "10:22" })).rejects.toBeDefined();
    await expect(updateRefreshCheckpoint(context.db, { checkpointId: created.id, localTime: "11:00" })).rejects.toBeDefined();
  });

  it("preserves a valid retry offset order exactly as configured", async () => {
    await setRefreshRetryOffsets(context.db, { retryOffsetsSeconds: [120, 0, 600] });
    await expect(getCurrentRefreshSettings(context.db)).resolves.toMatchObject({
      retryOffsetsSeconds: [120, 0, 600],
    });
  });

  it("rejects unsafe raw SQL values at the database boundary", async () => {
    for (const localTime of ["24:00", "08:60", "8:00", "08:00Z", "08:00:00"]) {
      await expect(context.sql`
        insert into refresh_checkpoints (local_time, enabled)
        values (${localTime}, true)
      `).rejects.toMatchObject({ constraint_name: "refresh_checkpoints_local_time_valid" });
    }
    await expect(context.sql`
      update refresh_settings
      set retry_offsets_seconds = '[0,30,120,300,600]'::jsonb
      where singleton_id = 1
    `).resolves.toBeDefined();
    for (const retryOffsetsSeconds of [
      "[-1]",
      "[0,30,30]",
      "[0,30.5]",
      "[]",
      "[86401]",
      "null",
      "{}",
      "0",
      '"0"',
      "true",
      '["0"]',
      "[true]",
      "[null]",
      "[{}]",
      "[1e-3]",
      "[1.5]",
      "[9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999]",
    ]) {
      await expect(context.sql`
        update refresh_settings
        set retry_offsets_seconds = ${retryOffsetsSeconds}::jsonb
        where singleton_id = 1
      `).rejects.toMatchObject({ constraint_name: "refresh_settings_retry_offsets_valid" });
    }
  });

  it("serializes competing singleton writes and duplicate checkpoint creation", async () => {
    const [left, right] = await Promise.all([
      setAutoRefreshEnabled(context.db, { enabled: true }),
      setAutoRefreshEnabled(context.db, { enabled: false }),
    ]);
    expect([left.autoRefreshEnabled, right.autoRefreshEnabled]).toEqual(expect.arrayContaining([true, false]));
    expect((await getCurrentRefreshSettings(context.db)).revision).toBeGreaterThanOrEqual(Math.max(left.revision, right.revision));

    const localTime = "12:34";
    const results = await Promise.allSettled([
      addRefreshCheckpoint(context.db, { localTime }),
      addRefreshCheckpoint(context.db, { localTime }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});
