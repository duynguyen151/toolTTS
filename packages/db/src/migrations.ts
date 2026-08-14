import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import type { DatabaseContext } from "./client.js";

const defaultMigrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export async function migrateDatabase(
  context: DatabaseContext,
  migrationsFolder = defaultMigrationsFolder
): Promise<void> {
  await migrate(context.db, { migrationsFolder });
}
