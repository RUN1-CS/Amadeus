import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const sourceExtensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".vue",
]);
const databaseDrivers = new Set([
  "better-sqlite3",
  "mysql",
  "mysql2",
  "pg",
  "postgres",
  "sqlite3",
]);
const errors = [];

function isWithin(directory, target) {
  const pathFromDirectory = relative(directory, target);
  return (
    pathFromDirectory === "" ||
    (pathFromDirectory !== ".." &&
      !pathFromDirectory.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromDirectory))
  );
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      ["dist", "node_modules", ".git"].includes(entry.name)
    ) {
      continue;
    }

    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
  }

  return files;
}

const projects = [
  { name: "server", directory: resolve(repositoryRoot, "server") },
  { name: "web", directory: resolve(repositoryRoot, "web") },
];

for (const project of projects) {
  const files = await listFiles(project.directory);

  for (const file of files) {
    if (file.endsWith(".php")) {
      errors.push(
        `${relative(repositoryRoot, file)}: PHP source must not be added inside the ${project.name} service.`,
      );
    }

    if (!sourceExtensions.has(extname(file))) continue;
    const source = await readFile(file, "utf8");

    for (const match of source.matchAll(
      /\b(?:from\s*|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g,
    )) {
      const importedPath = resolve(dirname(file), match[1]);
      const otherProject = projects.find(
        (candidate) =>
          candidate.name !== project.name &&
          isWithin(candidate.directory, importedPath),
      );
      if (otherProject) {
        errors.push(
          `${relative(repositoryRoot, file)}: imports ${relative(repositoryRoot, importedPath)} across the ${project.name}/${otherProject.name} service boundary.`,
        );
      }
    }

    if (project.name === "server") {
      const lines = source.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (!/^\s*import\b/.test(lines[index])) continue;

        let declaration = lines[index];
        while (
          !/\bfrom\s*["']/.test(declaration) &&
          index + 1 < lines.length &&
          !/^\s*import\b/.test(lines[index + 1])
        ) {
          declaration += `\n${lines[++index]}`;
        }

        const pgImport =
          /^\s*import\s+(type\s+)?[\s\S]*?\s+from\s*["']pg(?:\/[^"']*)?["']/.exec(
            declaration,
          );
        if (
          pgImport &&
          !pgImport[1] &&
          !isWithin(resolve(project.directory, "db"), file) &&
          file !== resolve(project.directory, "db.ts")
        ) {
          errors.push(
            `${relative(repositoryRoot, file)}: runtime PostgreSQL imports must stay in server/db.`,
          );
        }
      }
    }
  }
}

const frontendPackage = JSON.parse(
  await readFile(resolve(repositoryRoot, "web/package.json"), "utf8"),
);
for (const group of [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
]) {
  for (const dependency of Object.keys(frontendPackage[group] ?? {})) {
    if (databaseDrivers.has(dependency)) {
      errors.push(
        `web/package.json: frontend must not depend on database driver "${dependency}".`,
      );
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exitCode = 1;
} else {
  console.log(
    "Service boundaries hold: no PHP inside Node/Vue services, no cross-service imports, and database drivers remain backend-only.",
  );
}