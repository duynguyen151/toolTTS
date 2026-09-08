import { describe, expect, it } from "vitest";

import {
  createOrGetPostIntent,
  findPostIntentForTracking,
  listPendingPostIntents,
  type CreatePostIntentInput
} from "./cotik-tracking.js";

const intentInput: CreatePostIntentInput = {
  orderId: "order-1",
  tracking: "GFU123456789012345",
  providerId: "provider-1",
  accountId: "account-1",
  logicalShopId: "shop-1",
  region: "UK"
};

function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-1",
    fingerprint: "fingerprint-1",
    orderId: intentInput.orderId,
    tracking: intentInput.tracking,
    providerId: intentInput.providerId,
    accountId: "account-old",
    logicalShopId: "shop-old",
    region: "US",
    status: "PENDING",
    attemptCount: 0,
    maxAttempts: 3,
    lastAttemptAt: null,
    confirmedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

function createReservationDb(rows: Array<ReturnType<typeof intent>>) {
  let activeTransaction = false;

  type FakeDb = {
    transaction: <T>(callback: (tx: FakeDb) => Promise<T>) => Promise<T>;
    select: () => unknown;
    update: () => unknown;
    insert: () => unknown;
  };

  const db: FakeDb = {
    transaction: async <T>(callback: (tx: FakeDb) => Promise<T>): Promise<T> => {
      while (activeTransaction) await Promise.resolve();
      activeTransaction = true;
      try {
        return await callback(db);
      } finally {
        activeTransaction = false;
      }
    },
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            for: () => ({
            limit: async (limit: number) =>
                rows.filter((row) => row.status === "PENDING" && row.attemptCount < row.maxAttempts).slice(0, limit)
            })
          })
        })
      })
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const row = rows.find((candidate) => candidate.status === "PENDING");
            if (!row) return [];
            row.status = values.status as string;
            row.attemptCount += 1;
            row.lastAttemptAt = values.lastAttemptAt as never;
            row.updatedAt = values.updatedAt as Date;
            return [row];
          }
        })
      })
    }),
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: "attempt-1" }]
      })
    })
  };

  return { db, rows };
}

describe("Cotik tracking intent safety", () => {
  it("rejects a legacy delimiter collision instead of reusing another order tuple", async () => {
    const existing = intent({ logicalShopId: "shop-1", region: "UK", orderId: "a:b", tracking: "c", providerId: "d" });
    const db = {
      insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }) }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [existing] }) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [existing] }) }) })
    };
    await expect(createOrGetPostIntent(db as never, { ...intentInput, orderId: "a", tracking: "b:c", providerId: "d" })).rejects.toThrow("identity conflict");
  });
  it("atomically reserves an intent once when two workers race", async () => {
    const { db, rows } = createReservationDb([intent()]);

    const [first, second] = await Promise.all([
      listPendingPostIntents(db as never, 1, { reserve: true }),
      listPendingPostIntents(db as never, 1, { reserve: true })
    ]);

    expect(first).toHaveLength(1);
    expect(first[0]?.attemptCount).toBe(1);
    expect(second).toEqual([]);
    expect(rows[0]).toMatchObject({ status: "IN_PROGRESS", attemptCount: 1 });
  });

  it("does not reserve beyond the persisted three-attempt budget", async () => {
    const { db, rows } = createReservationDb([intent({ attemptCount: 2 })]);

    const reserved = await listPendingPostIntents(db as never, 1, { reserve: true });
    const exhausted = await listPendingPostIntents(db as never, 1, { reserve: true });

    expect(reserved[0]?.attemptCount).toBe(3);
    expect(exhausted).toEqual([]);
    expect(rows[0]).toMatchObject({ status: "IN_PROGRESS", attemptCount: 3 });
  });

  it("persists the explicit region and reroutes only an untouched pending intent", async () => {
    const existing = intent({ region: "UK", accountId: "account-old", logicalShopId: "shop-1" });
    const db = {
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoNothing: () => ({
            returning: async () => []
          }),
        })
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [existing]
          })
        })
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => [{ ...existing, ...values }]
          })
        })
      })
    };

    const result = await createOrGetPostIntent(db as never, intentInput);

    expect(result).toMatchObject({ region: "UK", accountId: "account-1", logicalShopId: "shop-1" });
  });

  it("does not reroute a global fingerprint across logical shops or regions", async () => {
    const existing = intent({ logicalShopId: "shop-2", region: "US", accountId: "account-old" });
    let updateCalled = false;
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({ returning: async () => [] })
        })
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [existing] })
        })
      }),
      update: () => {
        updateCalled = true;
        return { set: () => ({ where: () => ({ returning: async () => [existing] }) }) };
      }
    };

    await expect(createOrGetPostIntent(db as never, intentInput)).rejects.toThrow(
      "Cotik post intent fingerprint identity conflict"
    );
    expect(updateCalled).toBe(false);
  });

  it("allows a readback reconciliation to update the reserved attempt to confirmed", async () => {
    const existingIntent = intent({ status: "IN_PROGRESS", attemptCount: 1 });
    const existingAttempt = {
      id: "attempt-1",
      intentId: existingIntent.id,
      attemptNo: 1,
      requestPayload: {},
      responsePayload: null,
      httpStatus: null,
      outcome: "UNCONFIRMED",
      readbackConfirmed: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    };
    let selectCount = 0;
    const db = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => ({
                limit: async () => ++selectCount === 1 ? [existingIntent] : [existingAttempt]
              }),
              limit: async () => ++selectCount === 1 ? [existingIntent] : [existingAttempt]
            })
          })
        }),
        update: () => ({
          set: (values: Record<string, unknown>) => ({
            where: () => ({
              returning: async () => [{ ...existingAttempt, ...values }]
            })
          })
        }),
        insert: () => ({
          values: () => ({ returning: async () => [existingAttempt] })
        })
      })
    };

    const result = await import("./cotik-tracking.js").then(({ recordPostAttempt }) =>
      recordPostAttempt(db as never, {
        intentId: existingIntent.id,
        attemptNo: 1,
        requestPayload: { orderId: "order-1" },
        outcome: "SUCCESS",
        readbackConfirmed: true
      })
    );

    expect(result).toMatchObject({ outcome: "SUCCESS", readbackConfirmed: true });
  });

  it("returns a unique sheet identity intent and refuses ambiguous matches", async () => {
    const existing = intent({ logicalShopId: "shop-1", region: "UK" });
    const makeDb = (rows: unknown[]) => ({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => rows })
          })
        })
      })
    });

    await expect(findPostIntentForTracking(makeDb([existing]) as never, {
      logicalShopId: "shop-1",
      orderId: intentInput.orderId,
      tracking: intentInput.tracking,
      region: "UK"
    })).resolves.toEqual(existing);
    await expect(findPostIntentForTracking(makeDb([existing, { ...existing, id: "intent-2" }]) as never, {
      logicalShopId: "shop-1",
      orderId: intentInput.orderId,
      tracking: intentInput.tracking,
      region: "UK"
    })).resolves.toBeNull();
  });

  it("rejects a claimed intent when an incoming winner changes shop identity", async () => {
    const existing = intent({ status: "IN_PROGRESS", attemptCount: 1, logicalShopId: "shop-1", region: "UK" });
    let updateCalled = false;
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({ returning: async () => [] })
        })
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [existing] })
        })
      }),
      update: () => {
        updateCalled = true;
        return { set: () => ({ where: () => ({ returning: async () => [existing] }) }) };
      }
    };

    await expect(createOrGetPostIntent(db as never, intentInput)).resolves.toMatchObject({
      status: "IN_PROGRESS",
      attemptCount: 1,
      accountId: "account-old"
    });
    expect(updateCalled).toBe(false);
  });
});
