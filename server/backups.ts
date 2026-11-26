import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, posix } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import SftpClient from "ssh2-sftp-client";
import { HttpError } from "./classes/httpError.js";
import {
  databaseBackupDirectory,
  databaseBackupRetentionDays,
  databaseBackupSftpDirectory,
  databaseBackupSftpHost,
  databaseBackupSftpHostFingerprint,
  databaseBackupSftpPassphrase,
  databaseBackupSftpPassword,
  databaseBackupSftpPort,
  databaseBackupSftpPrivateKey,
  databaseBackupSftpUsername,
  databaseBackupStorage,
  databaseBackupTimeoutMs,
  pgDumpPath,
  pgRestorePath,
} from "./config.js";

const executeFile = promisify(execFile);
const millisecondsPerDay = 24 * 60 * 60 * 1000;

function getSftpOptions() {
  if (
    !databaseBackupSftpHost ||
    !databaseBackupSftpUsername ||
    !databaseBackupSftpHostFingerprint ||
    (!databaseBackupSftpPassword && !databaseBackupSftpPrivateKey)
  ) {
    throw new Error(
      "SFTP backups require a host, username, host fingerprint, and password or private key.",
    );
  }

  const expectedFingerprint = databaseBackupSftpHostFingerprint
    .replace(/^SHA256:/, "")
    .replaceAll(":", "")
    .replaceAll("=", "");
  return {
    host: databaseBackupSftpHost,
    port: databaseBackupSftpPort,
    username: databaseBackupSftpUsername,
    ...(databaseBackupSftpPassword
      ? { password: databaseBackupSftpPassword }
      : {
          privateKey: databaseBackupSftpPrivateKey,
          ...(databaseBackupSftpPassphrase
            ? { passphrase: databaseBackupSftpPassphrase }
            : {}),
        }),
    hostHash: "sha256" as const,
    hostVerifier: (fingerprint: string) =>
      fingerprint.replaceAll("=", "") === expectedFingerprint,
  };
}

async function withSftpClient<T>(
  operation: (client: SftpClient) => Promise<T>,
) {
  const client = new SftpClient("amadeus-backups");
  await client.connect(getSftpOptions());
  try {
    return await operation(client);
  } finally {
    await client.end();
  }
}

async function expireLocalBackups(directory: string) {
  if (databaseBackupRetentionDays <= 0) return;
  const expireBefore =
    Date.now() - databaseBackupRetentionDays * millisecondsPerDay;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith("amadeus-") ||
      !entry.name.endsWith(".dump")
    ) {
      continue;
    }
    const filePath = join(directory, entry.name);
    if ((await stat(filePath)).mtimeMs < expireBefore) {
      await rm(filePath);
    }
  }
}

async function expireSftpBackups(client: SftpClient, directory: string) {
  if (databaseBackupRetentionDays <= 0) return;
  const expireBefore =
    Date.now() - databaseBackupRetentionDays * millisecondsPerDay;
  const entries = await client.list(directory);
  for (const entry of entries) {
    if (
      entry.type !== "-" ||
      !/^amadeus-.*\.dump$/.test(entry.name) ||
      entry.modifyTime >= expireBefore
    ) {
      continue;
    }
    await client.delete(posix.join(directory, entry.name));
  }
}

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

function getPostgresDatabaseName() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const databaseName = decodeURIComponent(
    new URL(connectionString).pathname.slice(1),
  );
  if (!databaseName)
    throw new Error("DATABASE_URL does not specify a database.");
  return databaseName;
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
    throw new Error(detail || `Database command failed (${command}).`, {
      cause: error,
    });
  }
}

async function backupContainsEncryptionManifest(filePath: string) {
  const expectedEntry = "TABLE DATA public data_encryption_manifest";
  return new Promise<boolean>((resolve, reject) => {
    const process = spawn(pgRestorePath, ["--list", filePath], {
      env: getPostgresEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: databaseBackupTimeoutMs,
    });
    let found = false;
    let stdoutTail = "";
    let stderrTail = "";
    process.stdout.on("data", (chunk: Buffer) => {
      const output = stdoutTail + chunk.toString();
      if (output.includes(expectedEntry)) found = true;
      stdoutTail = output.slice(-(expectedEntry.length - 1));
    });
    process.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-8192);
    });
    process.once("error", reject);
    process.once("close", (code, signal) => {
      if (code === 0) {
        resolve(found);
        return;
      }
      reject(
        new Error(
          stderrTail.trim() ||
            `Database command failed (${pgRestorePath}, exit ${code ?? signal}).`,
        ),
      );
    });
  });
}

export async function createDatabaseBackup(
  options: { persist?: boolean } = {},
) {
  const persist = options.persist ?? true;
  await mkdir(databaseBackupDirectory, { recursive: true, mode: 0o700 });
  if (persist && databaseBackupStorage === "local") {
    await expireLocalBackups(databaseBackupDirectory);
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
    const size = (await stat(filePath)).size;
    if (persist && databaseBackupStorage === "sftp") {
      const remoteDirectory = posix.resolve(databaseBackupSftpDirectory);
      await withSftpClient(async (client) => {
        await client.mkdir(remoteDirectory, true);
        const remotePath = posix.join(remoteDirectory, filename);
        const temporaryRemotePath = posix.join(
          remoteDirectory,
          `.${filename}.uploading`,
        );
        try {
          await client.fastPut(filePath, temporaryRemotePath);
          await client.rename(temporaryRemotePath, remotePath);
        } catch (error) {
          try {
            await client.delete(temporaryRemotePath, true);
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "SFTP backup upload failed and its temporary file could not be removed.",
            );
          }
          throw error;
        }
        await expireSftpBackups(client, remoteDirectory);
      });
    }
    return {
      filePath,
      filename,
      size,
      removeAfterResponse: !persist || databaseBackupStorage === "sftp",
    };
  } catch (error) {
    await rm(filePath, { force: true });
    throw error;
  }
}

export async function restoreDatabaseBackup(filePath: string) {
  if (!(await backupContainsEncryptionManifest(filePath))) {
    throw new Error(
      "This backup predates user-data encryption and cannot be restored safely.",
    );
  }
  await runPostgresCommand(pgRestorePath, [
    "--dbname",
    getPostgresDatabaseName(),
    "--exit-on-error",
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--single-transaction",
    filePath,
  ]);
}

export async function restoreLatestDatabaseBackup() {
  await mkdir(databaseBackupDirectory, { recursive: true, mode: 0o700 });
  let filePath: string;
  let removeAfterRestore = false;

  if (databaseBackupStorage === "local") {
    const entries = await readdir(databaseBackupDirectory, {
      withFileTypes: true,
    });
    const backups = await Promise.all(
      entries
        .filter(
          (entry) => entry.isFile() && /^amadeus-.*\.dump$/.test(entry.name),
        )
        .map(async (entry) => {
          const candidatePath = join(databaseBackupDirectory, entry.name);
          return {
            filePath: candidatePath,
            modifiedAt: (await stat(candidatePath)).mtimeMs,
          };
        }),
    );
    backups.sort((left, right) => right.modifiedAt - left.modifiedAt);
    const latest = backups[0];
    if (!latest) {
      throw new HttpError(
        404,
        "ONLINE_BACKUP_NOT_FOUND",
        "No online backup is available to roll back to.",
      );
    }
    filePath = latest.filePath;
  } else {
    const remoteDirectory = posix.resolve(databaseBackupSftpDirectory);
    let sftpRestorePath: string | undefined;
    try {
      filePath = await withSftpClient(async (client) => {
        if (!(await client.exists(remoteDirectory))) {
          throw new HttpError(
            404,
            "ONLINE_BACKUP_NOT_FOUND",
            "No online backup is available to roll back to.",
          );
        }
        const entries = await client.list(remoteDirectory);
        const latest = entries
          .filter(
            (entry) =>
              entry.type === "-" && /^amadeus-.*\.dump$/.test(entry.name),
          )
          .sort((left, right) => right.modifyTime - left.modifyTime)[0];
        if (!latest) {
          throw new HttpError(
            404,
            "ONLINE_BACKUP_NOT_FOUND",
            "No online backup is available to roll back to.",
          );
        }
        const restorePath = await createRestoreUploadPath();
        sftpRestorePath = restorePath;
        await client.fastGet(
          posix.join(remoteDirectory, latest.name),
          restorePath,
        );
        return restorePath;
      });
      removeAfterRestore = true;
    } catch (error) {
      if (sftpRestorePath) {
        try {
          await rm(sftpRestorePath, { force: true });
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "SFTP rollback failed and its temporary backup could not be removed.",
          );
        }
      }
      throw error;
    }
  }

  try {
    await restoreDatabaseBackup(filePath);
  } finally {
    if (removeAfterRestore) {
      await rm(filePath, { force: true });
    }
  }
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
  const filePath = join(
    databaseBackupDirectory,
    `restore-${randomUUID()}.dump`,
  );
  const file = await open(filePath, "wx", 0o600);
  await file.close();
  return filePath;
}

export async function streamBackup(filePath: string) {
  return createReadStream(filePath);
}
