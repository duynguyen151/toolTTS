import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import type { DatabaseContext } from "./client.js";

const defaultMigrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

const jsonbObjectLengthCompatibilitySql = `
CREATE OR REPLACE FUNCTION public.jsonb_object_length(value jsonb) RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) = 'object' THEN (
      SELECT count(*)::integer FROM jsonb_object_keys(value)
    )
    ELSE 0
  END;
$$;
`;

export async function migrateDatabase(
  context: DatabaseContext,
  migrationsFolder = defaultMigrationsFolder
): Promise<void> {
  // Historical migrations use this helper, which PostgreSQL does not provide natively.
  await context.sql.unsafe(jsonbObjectLengthCompatibilitySql);
  await migrate(context.db, { migrationsFolder });
}
