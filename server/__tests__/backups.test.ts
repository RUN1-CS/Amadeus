import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

let temporaryDirectory: string | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

it("restores archives whose table-of-contents listing exceeds 8 MiB", async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "amadeus-backup-test-"));
  const restoreCommand = join(temporaryDirectory, "pg_restore");
  await writeFile(
    restoreCommand,
    `#!/usr/bin/env node
if (process.argv.includes("--list")) {
  process.stdout.write("x".repeat(9 * 1024 * 1024));
  process.stdout.write("\\nTABLE DATA public data_encryption_manifest\\n");
}
`,
  );
  await chmod(restoreCommand, 0o700);
  vi.stubEnv("PG_RESTORE_PATH", restoreCommand);
  vi.stubEnv("DATABASE_URL", "postgres://user:password@localhost/amadeus");

  vi.resetModules();
  const { restoreDatabaseBackup } = await import("../backups.js");
  await expect(
    restoreDatabaseBackup("/tmp/backup.dump"),
  ).resolves.toBeUndefined();
});

it("rolls back using the most recently modified local online backup", async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "amadeus-backup-test-"));
  const restoreCommand = join(temporaryDirectory, "pg_restore");
  const restoreLog = join(temporaryDirectory, "restore-args.jsonl");
  const olderBackup = join(temporaryDirectory, "amadeus-older.dump");
  const latestBackup = join(temporaryDirectory, "amadeus-latest.dump");
  await writeFile(olderBackup, "older");
  await writeFile(latestBackup, "latest");
  await utimes(olderBackup, new Date(1_000), new Date(1_000));
  await utimes(latestBackup, new Date(2_000), new Date(2_000));
  await writeFile(
    restoreCommand,
    `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--list")) {
  process.stdout.write("TABLE DATA public data_encryption_manifest\\n");
}
fs.appendFileSync(${JSON.stringify(restoreLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");
`,
  );
  await chmod(restoreCommand, 0o700);
  vi.stubEnv("DATABASE_BACKUP_STORAGE", "local");
  vi.stubEnv("DATABASE_BACKUP_DIRECTORY", temporaryDirectory);
  vi.stubEnv("PG_RESTORE_PATH", restoreCommand);
  vi.stubEnv("DATABASE_URL", "postgres://user:password@localhost/amadeus");

  vi.resetModules();
  const { restoreLatestDatabaseBackup } = await import("../backups.js");
  await restoreLatestDatabaseBackup();

  const calls = (await readFile(restoreLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  expect(calls).toHaveLength(2);
  expect(calls.every((args) => args.at(-1) === latestBackup)).toBe(true);
  expect(calls[1]).toContain("--dbname");
  expect(calls[1]).toContain("amadeus");
});
