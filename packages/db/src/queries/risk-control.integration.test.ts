import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import { riskControlStates, shops } from "../schema.js";
import {
  recordHolidayModeObservation,
  recordRiskControlAction,
  saveRiskControlEvaluation,
} from "./risk-control.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("risk-control PostgreSQL persistence", () => {
  let context: DatabaseContext;
  let shopId: string;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
    const profileNo = `RISK-${randomUUID()}`;
    const [shop] = await context.db.insert(shops).values({
      profileId: profileNo,
      profileNo,
      displayName: "Risk-control integration",
      region: "US",
      locale: "en-US",
      currency: "USD",
    }).returning({ id: shops.id });
    shopId = shop!.id;
  });

  afterAll(async () => {
    if (!context) return;
    if (shopId) {
      await context.db.delete(riskControlStates).where(eq(riskControlStates.shopId, shopId));
      await context.db.delete(shops).where(eq(shops.id, shopId));
    }
    await closeDatabase(context);
  });

  it("serializes Date values in every risk-control greatest path", async () => {
    const evaluatedAt = new Date("2026-08-14T00:00:00.000Z");
    const observedAt = new Date("2026-08-14T01:00:00.000Z");
    const actionAt = new Date("2026-08-14T02:00:00.000Z");

    await saveRiskControlEvaluation(context.db, {
      shopId,
      desiredState: "HOLIDAY_MODE_OFF",
      consecutiveSafeCycles: 1,
      decision: { source: "integration" },
      policyVersion: "risk-control-policy.v1",
      evaluatedAt,
    });
    await expect(saveRiskControlEvaluation(context.db, {
      shopId,
      desiredState: "HOLIDAY_MODE_ON",
      consecutiveSafeCycles: 2,
      decision: { source: "integration", updated: true },
      policyVersion: "risk-control-policy.v1",
      evaluatedAt: observedAt,
    })).resolves.toMatchObject({
      lastEvaluatedAt: observedAt,
      updatedAt: observedAt,
    });

    await expect(recordHolidayModeObservation(context.db, {
      shopId,
      observedHolidayModeEnabled: false,
      observedAt,
    })).resolves.toMatchObject({
      lastObservedAt: observedAt,
      updatedAt: observedAt,
    });

    await expect(recordRiskControlAction(context.db, {
      shopId,
      actionAt,
      actionStatus: "SUCCEEDED",
      actionError: null,
      observedHolidayModeEnabled: false,
      automationOwned: false,
    })).resolves.toMatchObject({
      lastActionAt: actionAt,
      updatedAt: actionAt,
    });
  });
});
