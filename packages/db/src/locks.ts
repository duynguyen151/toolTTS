import { sql } from "drizzle-orm";

import type { DatabaseContext, DatabaseTransaction } from "./client.js";

const SHOP_SYNC_WRITE_LOCK_NAMESPACE = 1;
const SHOP_RISK_CONTROL_LOCK_NAMESPACE = 2;
const REFRESH_PROFILE_EXECUTION_LOCK_NAMESPACE = 3;

export async function withShopAdvisoryLock<T>(
  context: DatabaseContext,
  shopId: string,
  operation: () => Promise<T>
): Promise<T | null> {
  // Session-level advisory locks must acquire and release on the same pooled connection.
  const connection = await context.sql.reserve();

  try {
    const [{ acquired }] = await connection<[{ acquired: boolean }]>`
      select pg_try_advisory_lock(hashtextextended(${shopId}, 0)) as acquired
    `;

    if (!acquired) {
      return null;
    }

    try {
      return await operation();
    } finally {
      await connection`select pg_advisory_unlock(hashtextextended(${shopId}, 0))`;
    }
  } finally {
    connection.release();
  }
}
export async function withTransactionalShopLock<T>(
  context: DatabaseContext,
  shopId: string,
  operation: (transaction: DatabaseTransaction) => Promise<T>
): Promise<T> {
  return context.db.transaction(async (transaction) => {
    // Use a separate namespace from the outer session lock. A sync holds that
    // lock on a reserved connection while Drizzle transactions use another
    // pooled connection; reusing the same key would deadlock the sync against itself.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${shopId}, ${SHOP_SYNC_WRITE_LOCK_NAMESPACE}))`
    );
    return operation(transaction);
  });
}

/** Rejects a second worker for the same AdsPower profile while one claimed refresh attempt owns it. */
export async function withRefreshProfileExecutionLock<T>(
  context: DatabaseContext,
  profileId: string,
  operation: () => Promise<T>,
): Promise<T | null> {
  const connection = await context.sql.reserve();
  try {
    const [{ acquired }] = await connection<[{ acquired: boolean }]>`
      select pg_try_advisory_lock(hashtextextended(${profileId}, ${REFRESH_PROFILE_EXECUTION_LOCK_NAMESPACE})) as acquired
    `;
    if (!acquired) return null;
    try {
      return await operation();
    } finally {
      await connection`select pg_advisory_unlock(hashtextextended(${profileId}, ${REFRESH_PROFILE_EXECUTION_LOCK_NAMESPACE}))`;
    }
  } finally {
    connection.release();
  }
}
export async function withShopRiskControlLock<T>(
  context: DatabaseContext,
  shopId: string,
  operation: (transaction: DatabaseTransaction) => Promise<T>
): Promise<T> {
  return context.db.transaction(async (transaction) => {
    // Risk evaluation needs a separate namespace so it can serialize its own
    // read/evaluate/save cycle without waiting on unrelated order batch writes.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${shopId}, ${SHOP_RISK_CONTROL_LOCK_NAMESPACE}))`
    );
    return operation(transaction);
  });
}

const COTIK_CYCLE_EXECUTION_LOCK_NAMESPACE = 4;

/** Prevents concurrent worker instances from running overlapping Cotik sync/write cycles */
export async function withCotikCycleExecutionLock<T>(
  context: DatabaseContext,
  operation: () => Promise<T>
): Promise<T | null> {
  const connection = await context.sql.reserve();
  try {
    const [{ acquired }] = await connection<[{ acquired: boolean }]>`
      select pg_try_advisory_lock(hashtextextended('cotik_worker_cycle', ${COTIK_CYCLE_EXECUTION_LOCK_NAMESPACE})) as acquired
    `;
    if (!acquired) {
      return null;
    }
    try {
      return await operation();
    } finally {
      await connection`select pg_advisory_unlock(hashtextextended('cotik_worker_cycle', ${COTIK_CYCLE_EXECUTION_LOCK_NAMESPACE}))`;
    }
  } finally {
    connection.release();
  }
}
