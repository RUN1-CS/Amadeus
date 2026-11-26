// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  databaseBackupDirectory,
  databaseBackupRetentionDays,
  databaseBackupTimeoutMs,
  pgDumpPath,
  pgRestorePath,
} from "./config.js";

const executeFile = promisify(execFile);
const millisecondsPerDay = 24 * 60 * 60 * 1000;

function getPostgresEnvironment() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  const connection = new URL(connectionString);
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    PGHOST: decodeURIComponent(connection.hostname),
    PGPORT: connection.port || "5432",
    PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
  };
  const supportedOptions = new Set([
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "application_name",
    "connect_timeout",
  ]);
  for (const [key, value] of connection.searchParams) {
    if (supportedOptions.has(key)) {
      environment[`PG${key.toUpperCase()}`] = value;
    }
  }
  return environment;
}

async function runPostgresCommand(command: string, args: string[]) {
  try {
    const result = await executeFile(command, args, {
      env: getPostgresEnvironment(),
      timeout: databaseBackupTimeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    const detail =
      typeof error === "object" &&
      error !== null &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr.trim()
        : "";
    throw new Error(
      detail || `Database command failed (${command}).`,
      { cause: error },
    );
  }
}

export async function createDatabaseBackup() {
  await mkdir(databaseBackupDirectory, { recursive: true, mode: 0o700 });
  if (databaseBackupRetentionDays > 0) {
    const expireBefore = Date.now() - databaseBackupRetentionDays * millisecondsPerDay;
    const entries = await readdir(databaseBackupDirectory, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith("amadeus-") || !entry.name.endsWith(".dump")) {
        continue;
      }
      const filePath = join(databaseBackupDirectory, entry.name);
      if ((await stat(filePath)).mtimeMs < expireBefore) {
        await rm(filePath);
      }
    }
  }
  const filename = `amadeus-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.dump`;
  const filePath = join(databaseBackupDirectory, filename);
  const file = await open(filePath, "wx", 0o600);
  await file.close();

  try {
    await runPostgresCommand(pgDumpPath, [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--exclude-table=public.user_data_keys",
      "--file",
      filePath,
    ]);
    return { filePath, filename, size: (await stat(filePath)).size };
  } catch (error) {
    await rm(filePath, { force: true });
    throw error;
  }
}

export async function restoreDatabaseBackup(filePath: string) {
  const listing = await runPostgresCommand(pgRestorePath, [
    "--list",
    filePath,
  ]);
  if (!listing.includes("TABLE DATA public data_encryption_manifest")) {
    throw new Error(
      "This backup predates user-data encryption and cannot be restored safely.",
    );
  }
  await runPostgresCommand(pgRestorePath, [
    "--exit-on-error",
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--single-transaction",
    filePath,
  ]);
}

export async function purgeLegacyDatabaseBackups() {
  await mkdir(databaseBackupDirectory, { recursive: true, mode: 0o700 });
  const markerPath = join(databaseBackupDirectory, ".user-data-encryption-v2");
  try {
    await readFile(markerPath);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const entries = await readdir(databaseBackupDirectory, {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (entry.isFile() && /^amadeus-.*\.dump$/.test(entry.name)) {
      await rm(join(databaseBackupDirectory, entry.name));
    }
  }
  try {
    await writeFile(markerPath, "user-data-v2\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export async function createRestoreUploadPath() {
  await mkdir(databaseBackupDirectory, { recursive: true, mode: 0o700 });
  const filePath = join(databaseBackupDirectory, `restore-${randomUUID()}.dump`);
  const file = await open(filePath, "wx", 0o600);
  await file.close();
  return filePath;
}

export async function streamBackup(filePath: string) {
  return createReadStream(filePath);
}
