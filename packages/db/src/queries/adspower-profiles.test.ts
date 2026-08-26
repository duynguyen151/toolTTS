import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import type { Database } from "../client.js";
import { listAutomaticRefreshEligibleAdsPowerProfileShops } from "./adspower-profiles.js";

describe("listAutomaticRefreshEligibleAdsPowerProfileShops", () => {
  it("selects active observations at or after the freshness cutoff", async () => {
    let where: SQL | undefined;
    const query = {
      innerJoin: () => query,
      where: (condition: SQL) => {
        where = condition;
        return query;
      },
      orderBy: async () => [],
    };
    const db = {
      select: () => ({ from: () => query }),
    } as unknown as Database;
    const now = new Date("2026-01-15T00:12:00.000Z");

    await listAutomaticRefreshEligibleAdsPowerProfileShops(db, now);

    const compiled = new PgDialect().sqlToQuery(where!);
    expect(compiled.sql).toContain('"adspower_profiles"."observed_status_at" is not null');
    expect(compiled.sql).toMatch(/"adspower_profiles"\."observed_status_at" >= \$\d+/);
    expect(compiled.params).toContain("2026-01-15T00:02:00.000Z");
  });
});
