// Startup, schema migration, log retention, and post-restore reconciliation.
import migrate from "./migrate.js";
import { getErrorType, logger, setDatabaseLogWriter } from "../logger.js";
import { logCleanupIntervalMs, logRetentionMs } from "../config.js";
import {
  encryptLegacyUserData,
  removeUsersWithoutDataKeys,
  validateDataEncryptionKey,
} from "../data-encryption.js";
import { purgeLegacyDatabaseBackups } from "../backups.js";
import { pool } from "./pool.js";

async function pruneServerLogs() {
  try {
    await pool.query("DELETE FROM server_logs WHERE logged_at < $1", [
      new Date(Date.now() - logRetentionMs),
    ]);
  } catch (error) {
    logger.error(
      {
        event: "database.log_retention_cleanup_failed",
        errorType: getErrorType(error),
      },
      "Could not delete expired server logs",
    );
  }
}

// Apply additive schema changes to databases created before the current schema.
export async function initializeDatabase() {
  validateDataEncryptionKey();
  await migrate(pool);
  await encryptLegacyUserData(pool);
  await purgeLegacyDatabaseBackups();
  setDatabaseLogWriter(async ({ loggedAt, level, event, metadata }) => {
    await pool.query(
      `INSERT INTO server_logs (logged_at, level, event, metadata)
       VALUES ($1, $2, $3, $4)`,
      [loggedAt, level, event, JSON.stringify(metadata)],
    );
  });
  await pruneServerLogs();
  const cleanup = setInterval(
    () => void pruneServerLogs(),
    logCleanupIntervalMs,
  );
  cleanup.unref();
}

export async function reconcileUsersAfterRestore() {
  await migrate(pool);
  await encryptLegacyUserData(pool);
  await removeUsersWithoutDataKeys(pool);
  await pool.query(
    `SELECT setval(
       pg_get_serial_sequence('users', 'id'),
       GREATEST(
         COALESCE((SELECT MAX(id) FROM users), 0),
         COALESCE((SELECT MAX(user_id) FROM user_data_keys), 0)
       ) + 1,
       false
     )`,
  );
}
