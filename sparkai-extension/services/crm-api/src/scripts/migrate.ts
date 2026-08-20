import { parseCrmConfig } from "../config.js";
import { runMigrations } from "../db/migrations.js";

const config = parseCrmConfig(process.env);

try {
  await runMigrations(config);
  console.log(`CRM database migrated: ${config.databaseName}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
