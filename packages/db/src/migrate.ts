import { closeDatabase, createDatabase } from "./client.js";
import { readDatabaseConfig } from "./config.js";
import { migrateDatabase } from "./migrations.js";

const config = readDatabaseConfig();
const database = createDatabase(config.databaseUrl);

try {
  await migrateDatabase(database);
  process.stdout.write("Database migrations completed.\n");
} finally {
  await closeDatabase(database);
}
