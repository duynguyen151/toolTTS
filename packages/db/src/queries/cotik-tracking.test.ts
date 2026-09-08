import { describe, expect, it } from "vitest";

import {
  createCotikTrackingReplayRun,
  computeTrackingFingerprint,
  createOrGetPostIntent,
  findPostIntentForTracking,
  listPendingPostIntents,
  reopenPostIntentForReplay,
  stageConfirmedPostIntentForReplay,
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
    runId: "00000000-0000-4000-8000-000000000021",
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
  it("creates a fresh replay run that preserves the source run identity", async () => {
    let values: Record<string, unknown> | undefined;
    const db = {
      insert: () => ({
        values: (input: Record<string, unknown>) => {
          values = input;
          return { returning: async () => [{ id: "replay-run-1", ...input }] };
        }
      })
    };

    const run = await createCotikTrackingReplayRun(db as never, { sourceRunId: "source-run-1" });

    expect(run).toMatchObject({ id: "replay-run-1", mode: "REPLAY", sourceRunId: "source-run-1" });
    expect(values).toMatchObject({ mode: "REPLAY", sourceRunId: "source-run-1" });
  });

  it("keeps the historical fingerprint stable while replay is scoped by a new run", () => {
    const historical = computeTrackingFingerprint("order-1", "GFU123456789012345", "provider-1");
    const replay = computeTrackingFingerprint("order-1", "GFU123456789012345", "provider-1");

    expect(replay).toBe(historical);
  });

  it("refuses to clone a non-confirmed intent into a replay run", async () => {
    const source = intent({ status: "PENDING" });
    const db = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        select: () => ({
          from: () => ({
            where: () => ({ for: () => ({ limit: async () => [source] }) })
          })
        })
      })
    };

    await expect(stageConfirmedPostIntentForReplay(db as never, {
      sourceIntentId: source.id,
      runId: "replay-run-1"
    })).rejects.toThrow("Only a confirmed Cotik post intent can be staged for replay");
  });

  it("clones a confirmed intent into a new replay run", async () => {
    const source = intent({ status: "CONFIRMED" });
    const inserted: Record<string, unknown>[] = [];
    const candidate = { ...source, id: "candidate-replay", runId: "replay-run-1" };
    const replayIntent = { ...source, id: "intent-replay", status: "PENDING", attemptCount: 0, runId: "replay-run-1" };
    let selectCount = 0;
    const db = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => ({
                limit: async () => ++selectCount === 1
                  ? [source]
                  : [{ id: "replay-run-1", mode: "REPLAY", sourceRunId: source.runId }]
              })
            })
          })
        }),
        insert: () => ({
          values: (values: Record<string, unknown>) => {
            inserted.push(values);
            return {
              onConflictDoNothing: () => ({
                returning: async () => [inserted.length === 1 ? candidate : replayIntent]
              })
            };
          }
        })
      })
    };

    const result = await stageConfirmedPostIntentForReplay(db as never, {
      sourceIntentId: source.id,
      runId: "replay-run-1"
    });

    expect(result.intent).toMatchObject({ id: "intent-replay", status: "PENDING", runId: "replay-run-1" });
    expect(inserted).toHaveLength(2);
    expect(inserted.every((values) => values.runId === "replay-run-1")).toBe(true);
  });

  it("reopens a terminal intent without resetting its attempt history", async () => {
    const existing = intent({
      status: "FAILED",
      attemptCount: 2,
      maxAttempts: 3,
      lastAttemptAt: new Date("2026-01-01T00:01:00.000Z"),
      confirmedAt: new Date("2026-01-01T00:01:00.000Z")
    });
    let updateCalled = false;
    const db = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => ({ limit: async () => [existing] })
            })
          })
        }),
        update: () => ({
          set: (values: Record<string, unknown>) => ({
            where: () => ({
              returning: async () => {
                updateCalled = true;
                Object.assign(existing, values);
                return [existing];
              }
            })
          })
        })
      })
    };

    const result = await reopenPostIntentForReplay(db as never, existing.id);

    expect(updateCalled).toBe(true);
    expect(result).toMatchObject({
      status: "PENDING",
      attemptCount: 2,
      maxAttempts: 3,
      lastAttemptAt: new Date("2026-01-01T00:01:00.000Z"),
      confirmedAt: null
    });
  });

  it("leaves an exhausted terminal intent unchanged", async () => {
    const existing = intent({ status: "ABORTED", attemptCount: 3, maxAttempts: 3 });
    let updateCalled = false;
    const db = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => ({ limit: async () => [existing] })
            })
          })
        }),
        update: () => {
          updateCalled = true;
          return { set: () => ({ where: () => ({ returning: async () => [existing] }) }) };
        }
      })
    };

    await expect(reopenPostIntentForReplay(db as never, existing.id)).resolves.toEqual(existing);
    expect(updateCalled).toBe(false);
  });

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
