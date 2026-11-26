// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const exec = promisify(execFile);
const containerName = `amadeus-db-test-${process.pid}-${Date.now()}`;
const database = "amadeus";
const user = "amadeus";
const password = "amadeus-test";
const databaseUrl = process.env.DATABASE_URL;

let port = "";
let dockerAvailable = Boolean(databaseUrl);
let pool: Pool | undefined;
let persistedUserId = 0;
let persistedChatId = 0;

if (!databaseUrl) {
  try {
    execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: 2_000,
      stdio: "ignore",
    });
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }
}

async function docker(args: string[]) {
  return exec("docker", args, { timeout: 120_000 });
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await docker([
        "exec",
        containerName,
        "pg_isready",
        "-U",
        user,
        "-d",
        database,
      ]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("PostgreSQL container did not become ready.");
}

beforeAll(async () => {
  if (databaseUrl) {
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query("SELECT 1");
    const connection = new URL(databaseUrl);
    port = connection.port || "5432";
    return;
  }
  try {
    await docker(["info", "--format", "{{.ServerVersion}}"]);
  } catch {
    return;
  }
  try {
    await docker([
      "run",
      "--rm",
      "-d",
      "--name",
      containerName,
      "-e",
      `POSTGRES_DB=${database}`,
      "-e",
      `POSTGRES_USER=${user}`,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-p",
      "127.0.0.1::5432",
      "pgvector/pgvector:pg17",
    ]);
  } catch {
    return;
  }
  dockerAvailable = true;
  await waitForPostgres();
  const published = await docker(["port", containerName, "5432/tcp"]);
  port = published.stdout.trim().split(":").at(-1) ?? "";
  pool = new Pool({
    connectionString: `postgres://${user}:${password}@127.0.0.1:${port}/${database}`,
  });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  if (dockerAvailable) {
    await docker(["rm", "-f", containerName]).catch(() => undefined);
  }
});

async function psql(sql: string, db = database) {
  if (databaseUrl) {
    const url = new URL(databaseUrl);
    url.pathname = `/${db}`;
    const databasePool = new Pool({ connectionString: url.toString() });
    try {
      await databasePool.query(sql);
    } finally {
      await databasePool.end();
    }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn("docker", [
      "exec",
      "-i",
      containerName,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      user,
      "-d",
      db,
    ]);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql failed: ${stderr}`));
    });
    child.stdin.end(sql);
  });
}

describe.skipIf(!dockerAvailable)("Database integration", () => {
  it("migrates an empty database", async () => {
    if (!dockerAvailable) return;
    const { default: migrate } = await import("../migrate.js");
    await migrate(pool!);
    const result = await pool!.query(
      "SELECT name FROM migrations ORDER BY name",
    );
    expect(result.rows).toHaveLength(8);
    expect(result.rows.at(-1)?.name).toBe("008_user_owner.sql");
    const owner = await pool!.query(
      "SELECT user_id FROM user_admins WHERE is_owner",
    );
    const users = await pool!.query("SELECT COUNT(*)::int AS count FROM users");
    expect(owner.rows).toHaveLength(users.rows[0].count > 0 ? 1 : 0);
  });

  it("migrates from an older 001-only schema", async () => {
    if (!dockerAvailable) return;
    const oldDatabase = `amadeus_old_${process.pid}`;
    await psql(`CREATE DATABASE ${oldDatabase};`);
    const oldPool = new Pool({
      connectionString: databaseUrl
        ? new URL(`/${oldDatabase}`, databaseUrl).toString()
        : `postgres://${user}:${password}@127.0.0.1:${port}/${oldDatabase}`,
    });
    try {
      const migration001 = await readFile(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "..",
          "migrations",
          "001_init.sql",
        ),
      );
      await psql(migration001.toString(), oldDatabase);
      await psql(
        "CREATE TABLE migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()); INSERT INTO migrations(name) VALUES ('001_init.sql');",
        oldDatabase,
      );
      const { default: migrate } = await import("../migrate.js");
      await migrate(oldPool);
      const result = await oldPool.query(
        "SELECT name FROM migrations ORDER BY name",
      );
      expect(result.rows.map((row) => row.name)).toContain(
        "008_user_owner.sql",
      );
    } finally {
      await oldPool.end();
    }
  });

  it("rolls back a failed migration transaction", async () => {
    if (!dockerAvailable) return;
    const migrationDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "migrations",
    );
    const migrationPath = join(migrationDir, "998_rollback_test.sql");
    await (
      await import("node:fs/promises")
    ).writeFile(
      migrationPath,
      "CREATE TABLE migration_rollback_marker (id integer); THIS IS INVALID SQL;",
    );
    try {
      const { default: migrate } = await import("../migrate.js");
      await expect(migrate(pool!)).rejects.toThrow();
      const marker = await pool!.query(
        "SELECT to_regclass('public.migration_rollback_marker') AS marker",
      );
      expect(marker.rows[0].marker).toBeNull();
      const record = await pool!.query(
        "SELECT 1 FROM migrations WHERE name = '998_rollback_test.sql'",
      );
      expect(record.rowCount).toBe(0);
    } finally {
      await rm(migrationPath, { force: true });
    }
  });

  it("persists chats and messages", async () => {
    if (!dockerAvailable) return;
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        `INSERT INTO users (username, password_hash)
         VALUES ('chat-user', 'hash') RETURNING id`,
      );
      persistedUserId = Number(userResult.rows[0].id);
      const owner = await client.query(
        "SELECT 1 FROM user_admins WHERE is_owner",
      );
      await client.query(
        "INSERT INTO user_admins (user_id, is_owner) VALUES ($1, $2)",
        [persistedUserId, owner.rowCount === 0],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const chatResult = await pool!.query(
      `INSERT INTO chats (user_id, title)
       VALUES ($1, 'Persistence test') RETURNING id`,
      [persistedUserId],
    );
    persistedChatId = Number(chatResult.rows[0].id);
    await pool!.query(
      `INSERT INTO messages (chat_id, user_id, sender, content)
       VALUES ($1, $2, 'user', 'Hello'), ($1, $2, 'assistant', 'Hi')`,
      [persistedChatId, persistedUserId],
    );
    const result = await pool!.query(
      `SELECT c.title, m.sender, m.content
       FROM chats c JOIN messages m ON m.chat_id = c.id
       WHERE c.id = $1 AND c.user_id = $2
       ORDER BY m.id`,
      [persistedChatId, persistedUserId],
    );
    expect(result.rows).toEqual([
      { title: "Persistence test", sender: "user", content: "Hello" },
      { title: "Persistence test", sender: "assistant", content: "Hi" },
    ]);
  });

  it("creates and restores a PostgreSQL backup", async () => {
    if (!dockerAvailable) return;
    const backupChat = await pool!.query(
      `INSERT INTO chats (user_id, title)
       VALUES ($1, 'Before backup') RETURNING id`,
      [persistedUserId],
    );
    const backupChatId = Number(backupChat.rows[0].id);
    await pool!.query(
      `INSERT INTO messages (chat_id, user_id, sender, content)
       VALUES ($1, $2, 'user', 'Backup data')`,
      [backupChatId, persistedUserId],
    );

    const backupDirectory = await mkdtemp(join(tmpdir(), "amadeus-db-test-"));
    const backupPath = join(backupDirectory, "amadeus-test.dump");
    try {
      if (databaseUrl) {
        await exec("pg_dump", [
          "--dbname",
          databaseUrl,
          "--format=custom",
          "--no-owner",
          "--no-privileges",
          "--exclude-table=public.user_data_keys",
          "--file",
          backupPath,
        ]);
      } else {
        await docker([
          "exec",
          containerName,
          "pg_dump",
          "-U",
          user,
          "-d",
          database,
          "--format=custom",
          "--no-owner",
          "--no-privileges",
          "--exclude-table=public.user_data_keys",
          "--file",
          "/tmp/amadeus-test.dump",
        ]);
      }

      await pool!.query("DELETE FROM chats WHERE id = $1", [backupChatId]);
      const afterChat = await pool!.query(
        `INSERT INTO chats (user_id, title)
       VALUES ($1, 'After backup') RETURNING id`,
        [persistedUserId],
      );
      const afterChatId = Number(afterChat.rows[0].id);

      if (databaseUrl) {
        await exec("pg_restore", [
          "--dbname",
          databaseUrl,
          "--exit-on-error",
          "--clean",
          "--if-exists",
          "--no-owner",
          "--no-privileges",
          "--single-transaction",
          backupPath,
        ]);
      } else {
        await docker([
          "exec",
          containerName,
          "pg_restore",
          "-U",
          user,
          "--exit-on-error",
          "--clean",
          "--if-exists",
          "--no-owner",
          "--no-privileges",
          "--single-transaction",
          "-d",
          database,
          "/tmp/amadeus-test.dump",
        ]);
      }

      const result = await pool!.query(
        "SELECT id, title FROM chats WHERE user_id = $1 ORDER BY id",
        [persistedUserId],
      );
      expect(result.rows).toContainEqual({
        id: String(backupChatId),
        title: "Before backup",
      });
      expect(result.rows).not.toContainEqual({
        id: String(afterChatId),
        title: "After backup",
      });
    } finally {
      await rm(backupDirectory, { recursive: true, force: true });
    }
  });
});
