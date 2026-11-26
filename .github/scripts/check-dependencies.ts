// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const dependencyGroups = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
];
let hasErrors = false;

function sortedJson(value) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

for (const project of ["server", "web"]) {
  const projectDirectory = resolve(repositoryRoot, project);
  const packageJson = JSON.parse(
    await readFile(resolve(projectDirectory, "package.json"), "utf8"),
  );
  const lockfile = JSON.parse(
    await readFile(resolve(projectDirectory, "package-lock.json"), "utf8"),
  );
  const lockRoot = lockfile.packages?.[""];

  if (!lockRoot) {
    console.error(`${project}: package-lock.json has no root package entry.`);
    hasErrors = true;
    continue;
  }

  for (const field of ["name", "version"]) {
    if (packageJson[field] !== lockRoot[field]) {
      console.error(
        `${project}: ${field} differs between package.json and package-lock.json.`,
      );
      hasErrors = true;
    }
  }

  for (const group of dependencyGroups) {
    if (sortedJson(packageJson[group]) !== sortedJson(lockRoot[group])) {
      console.error(
        `${project}: ${group} differs between package.json and package-lock.json.`,
      );
      hasErrors = true;
    }
  }
}

if (hasErrors) process.exitCode = 1;
else console.log("Both npm manifests match their lockfiles.");
