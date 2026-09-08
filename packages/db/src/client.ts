import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

function requiresTls(databaseUrl: string): boolean {
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  return hostname === "supabase.com" || hostname.endsWith(".supabase.com") ||
    hostname === "supabase.co" || hostname.endsWith(".supabase.co");
}

export function createDatabase(databaseUrl: string): DatabaseContext {
  const sql = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ...(requiresTls(databaseUrl) ? { ssl: "require" as const } : {})
  });

  return {
    db: drizzle(sql, { schema }),
    sql
  };
}

export type Database = ReturnType<typeof drizzle<typeof schema>>;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DatabaseContext {
  db: Database;
  sql: postgres.Sql;
}

export async function closeDatabase(context: DatabaseContext): Promise<void> {
  await context.sql.end({ timeout: 5 });
}

export async function pingDatabase(context: DatabaseContext): Promise<void> {
  await context.sql`select 1`;
}
