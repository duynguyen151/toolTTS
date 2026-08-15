import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDatabase, createDatabase, type DatabaseContext } from "../client.js";
import { migrateDatabase } from "../migrations.js";
import { shops } from "../schema.js";
import {
  createAdsPowerProfile,
  getAdsPowerProfile,
  linkAdsPowerProfileToShop,
  setAdsPowerProfileVerification,
} from "./adspower-profiles.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("AdsPower profile PostgreSQL persistence", () => {
  let context: DatabaseContext;
  const profileId = `PROFILE-${randomUUID()}`;
  const profileNo = `PROFILE-NO-${randomUUID()}`;
  let shopId: string | undefined;

  beforeAll(async () => {
    context = createDatabase(databaseUrl!);
    await migrateDatabase(context);
  });

  afterAll(async () => {
    if (!context) return;
    await context.sql`delete from adspower_profiles where profile_id = ${profileId}`;
    if (shopId) await context.sql`delete from shops where id = ${shopId}`;
    await closeDatabase(context);
  });

  it("persists an UNVERIFIED AdsPower profile without a linked shop, then links exactly one proven shop", async () => {
    const profile = await createAdsPowerProfile(context.db, { profileId, profileNo });
    expect(profile).toMatchObject({
      profileId,
      profileNo,
      verificationState: "UNVERIFIED",
      activeShopId: null,
      lastVerifiedAt: null,
      verifiedTiktokShopId: null,
    });
    await expect(getAdsPowerProfile(context.db, profileId)).resolves.toMatchObject({ id: profile.id });

    const [shop] = await context.db.insert(shops).values({
      profileId: `SHOP-${randomUUID()}`,
      profileNo: `SHOP-NO-${randomUUID()}`,
      tiktokShopId: `TIKTOK-${randomUUID()}`,
      displayName: "Verified Test Shop",
      region: "US",
      locale: "en-US",
      verificationStatus: "VERIFIED",
      eligibilityStatus: "ELIGIBLE",
    }).returning();
    shopId = shop!.id;

    await expect(linkAdsPowerProfileToShop(context.db, profile.id, shop!.id)).rejects.toThrow(
      "must be READY and ELIGIBLE",
    );
    await setAdsPowerProfileVerification(context.db, profile.id, {
      verificationState: "READY",
      eligibilityStatus: "ELIGIBLE",
      verifiedTiktokShopId: shop!.tiktokShopId!,
    });

    await expect(linkAdsPowerProfileToShop(context.db, profile.id, shop!.id)).resolves.toMatchObject({
      activeShopId: shop!.id,
      verifiedTiktokShopId: shop!.tiktokShopId,
    });
  });
});
