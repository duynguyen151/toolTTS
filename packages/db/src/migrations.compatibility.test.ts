import { describe, expect, it, vi } from "vitest";

const { migrate } = vi.hoisted(() => ({ migrate: vi.fn() }));

vi.mock("drizzle-orm/postgres-js/migrator", () => ({ migrate }));

import { migrateDatabase } from "./migrations.js";

describe("migration compatibility", () => {
  it("installs the JSONB object-length compatibility function before historical migrations", async () => {
    const unsafe = vi.fn().mockResolvedValue([]);

    await migrateDatabase({
      db: {} as never,
      sql: { unsafe } as never,
    });

    expect(unsafe).toHaveBeenCalledWith(expect.stringContaining("jsonb_object_length"));
    expect(migrate).toHaveBeenCalledWith({}, expect.objectContaining({ migrationsFolder: expect.any(String) }));
    expect(unsafe.mock.invocationCallOrder[0]!).toBeLessThan(migrate.mock.invocationCallOrder[0]!);
  });
});
