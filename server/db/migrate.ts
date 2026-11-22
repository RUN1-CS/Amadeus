// Applies numbered *.sql migrations once, in lexical order.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { getErrorType, logger } from "../logger.js";

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );

  const dir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
  );
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('amadeus_migrations'))",
    );

    for (const file of files) {
      const applied = await client.query(
        "SELECT 1 FROM migrations WHERE name = $1",
        [file],
      );
      if (applied.rowCount) continue;

      await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
      await client.query("INSERT INTO migrations (name) VALUES ($1)", [file]);
      logger.info({ event: "database.migration_applied", migration: file });
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export default migrate;

// Allow running the runner directly: node dist/db/migrate.js
const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const standalonePool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  migrate(standalonePool)
    .catch((error: unknown) => {
      logger.fatal(
        { event: "database.migration_failed", errorType: getErrorType(error) },
        "Migration failed",
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await standalonePool.end();
    });
}
