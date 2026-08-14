import {
  closeDatabase,
  createDatabase,
  type DatabaseContext
} from "@shop-health/db";

import type { CliRuntime } from "./runtime.js";
import { requireDatabaseUrl } from "./runtime.js";

export async function withDatabase<T>(
  runtime: CliRuntime,
  operation: (context: DatabaseContext) => Promise<T>
): Promise<T> {
  const context = createDatabase(requireDatabaseUrl(runtime));
  try {
    return await operation(context);
  } finally {
    await closeDatabase(context);
  }
}
