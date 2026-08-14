import { z } from "zod";

const databaseConfigSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "postgres:" || protocol === "postgresql:";
      } catch {
        return false;
      }
    }, "DATABASE_URL must be a valid PostgreSQL URL")
});

export interface DatabaseConfig {
  databaseUrl: string;
}

export function readDatabaseConfig(environment: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const result = databaseConfigSchema.safeParse(environment);
  if (!result.success) {
    throw new Error(`Invalid database configuration: ${z.prettifyError(result.error)}`);
  }

  return { databaseUrl: result.data.DATABASE_URL };
}
