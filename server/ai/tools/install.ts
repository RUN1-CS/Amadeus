// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "../../logger.js";
import {
  getMcpInstallRoot,
  getMcpServerDirectory,
  getToolConfiguration,
  type McpServerConfig,
} from "./tool-config.js";

const npmRegistry = "https://registry.npmjs.org/";

function isMissingFile(error: unknown) {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`,
          ),
        );
      }
    });
  });
}

function runCapture(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function verifyPackageIntegrity(
  directory: string,
  config: McpServerConfig,
) {
  const lockPath = join(directory, "package-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
    packages?: Record<string, { version?: string; integrity?: string }>;
  };
  const installed = lock.packages?.[`node_modules/${config.package.name}`];
  if (
    installed?.version !== config.package.version ||
    installed.integrity !== config.package.integrity
  ) {
    throw new Error(
      `Installed package integrity mismatch for ${config.package.name}@${config.package.version}.`,
    );
  }
}

async function isPackageInstalled(directory: string, config: McpServerConfig) {
  try {
    const lock = JSON.parse(
      await readFile(join(directory, "package-lock.json"), "utf8"),
    ) as {
      packages?: Record<string, { version?: string; integrity?: string }>;
    };
    const manifest = JSON.parse(
      await readFile(
        join(directory, "node_modules", config.package.name, "package.json"),
        "utf8",
      ),
    ) as { version?: string };
    const installed = lock.packages?.[`node_modules/${config.package.name}`];
    return (
      manifest.version === config.package.version &&
      installed?.version === config.package.version &&
      installed.integrity === config.package.integrity
    );
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

async function installPackage(serverName: string, config: McpServerConfig) {
  await mkdir(getMcpInstallRoot(), { recursive: true, mode: 0o700 });
  const directory = getMcpServerDirectory(serverName);
  if (await isPackageInstalled(directory, config)) {
    await auditPackage(serverName, directory);
    return directory;
  }
  await run(
    "npm",
    [
      "install",
      "--prefix",
      directory,
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `--registry=${npmRegistry}`,
      `${config.package.name}@${config.package.version}`,
    ],
    getMcpInstallRoot(),
  );
  await run(
    "npm",
    [
      "ci",
      "--prefix",
      directory,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `--registry=${npmRegistry}`,
    ],
    getMcpInstallRoot(),
  );
  await verifyPackageIntegrity(directory, config);
  await auditPackage(serverName, directory);
  return directory;
}

async function auditPackage(serverName: string, directory: string) {
  const result = await runCapture(
    "npm",
    ["audit", "--prefix", directory, "--json", `--registry=${npmRegistry}`],
    getMcpInstallRoot(),
  );

  let audit: {
    metadata?: {
      vulnerabilities?: {
        info?: number;
        low?: number;
        moderate?: number;
        high?: number;
        critical?: number;
        total?: number;
      };
    };
  };
  try {
    audit = JSON.parse(result.stdout) as typeof audit;
  } catch {
    logger.warn(
      {
        event: "ai.tool_package_audit_unavailable",
        serverName,
        exitCode: result.code,
      },
      "Could not read npm audit results for the configured MCP package",
    );
    return;
  }

  const vulnerabilities = audit.metadata?.vulnerabilities;
  if (vulnerabilities && (vulnerabilities.total ?? 0) > 0) {
    logger.warn(
      { event: "ai.tool_package_vulnerabilities", serverName, vulnerabilities },
      "Vulnerabilities found in the configured MCP package dependencies",
    );
  } else if (result.code !== 0 || !vulnerabilities) {
    logger.warn(
      {
        event: "ai.tool_package_audit_unavailable",
        serverName,
        exitCode: result.code,
      },
      "npm audit did not return vulnerability results for the configured MCP package",
    );
  }
}

async function installBrowserEngines(
  serverName: string,
  config: McpServerConfig,
  directory: string,
) {
  if (config.browser_engines.length === 0) return;

  const markerPath = join(directory, ".amadeus-install.json");
  const markerContents = JSON.stringify({
    name: config.package.name,
    version: config.package.version,
    integrity: config.package.integrity,
    browser_engines: config.browser_engines,
  });
  try {
    if ((await readFile(markerPath, "utf8")) === markerContents) return;
  } catch (error) {
    if (
      error === null ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const playwrightCli = join(directory, "node_modules/playwright/cli.js");
  await run(
    process.execPath,
    [playwrightCli, "install", "--with-deps", ...config.browser_engines],
    directory,
  );
  await writeFile(markerPath, markerContents, { mode: 0o600 });
  logger.info({ event: "ai.tool_browsers_installed", serverName });
}

export async function installConfiguredTools() {
  const configuration = await getToolConfiguration();
  for (const [serverName, server] of Object.entries(
    configuration.mcp_servers,
  )) {
    if (!server.enabled) continue;

    logger.info(
      {
        event: "ai.tool_package_install",
        serverName,
        manager: server.package.manager,
        package: server.package.name,
        version: server.package.version,
      },
      "Installing configured MCP package",
    );
    const directory = await installPackage(serverName, server);
    await installBrowserEngines(serverName, server, directory);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  installConfiguredTools().catch((error: unknown) => {
    logger.fatal(
      {
        event: "ai.tool_install_failed",
        errorType: error instanceof Error ? error.name : "Unknown",
      },
      error instanceof Error
        ? error.message
        : "MCP package installation failed",
    );
    process.exitCode = 1;
  });
}
