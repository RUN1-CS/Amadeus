// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parse } from "yaml";
import { logger } from "../../logger.js";

export interface McpServerConfig {
  enabled: boolean;
  package: {
    manager: "npm";
    name: string;
    version: string;
    integrity: string;
  };
  command: string;
  args: string[];
  browser_engines: ("chromium" | "firefox" | "webkit")[];
  allowed_tools: string[] | null;
  normalize_url_arguments: Record<string, string>;
  evidence_tools: string[];
}

export interface ToolConfiguration {
  mcp_servers: Record<string, McpServerConfig>;
}

let configurationPromise: Promise<ToolConfiguration> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function isSha512Integrity(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("sha512-")) return false;
  const digest = value.slice("sha512-".length);
  return (
    /^[A-Za-z0-9+/]+={0,2}$/.test(digest) &&
    Buffer.from(digest, "base64").length === 64 &&
    Buffer.from(digest, "base64").toString("base64") === digest
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isBrowserEngineArray(
  value: unknown,
): value is ("chromium" | "firefox" | "webkit")[] {
  return (
    isStringArray(value) &&
    value.every((engine) =>
      ["chromium", "firefox", "webkit"].includes(engine),
    )
  );
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && "code" in error && error.code === "ENOENT";
}

export function getMcpInstallRoot() {
  return resolve(process.env.MCP_TOOLS_DIRECTORY ?? ".mcp-tools");
}

export function getMcpServerDirectory(serverName: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(serverName)) {
    throw new Error(`Invalid MCP server name: ${serverName}`);
  }
  return join(getMcpInstallRoot(), serverName);
}

async function readConfigurationText(): Promise<string> {
  const configuredPath = resolve(
    process.env.TOOLS_CONFIG_PATH ?? "ai/tools/tools.yml",
  );

  try {
    const contents = await readFile(configuredPath, "utf8");
    if (contents.trim()) return contents;
    logger.warn(
      { event: "ai.tools_config_empty", configPath: configuredPath },
      "Tool configuration is empty; loading the example configuration",
    );
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    logger.warn(
      { event: "ai.tools_config_missing", configPath: configuredPath },
      "Tool configuration is missing; loading the example configuration",
    );
  }

  return readFile(
    resolve(process.cwd(), "ai/tools/tools.example.yml"),
    "utf8",
  );
}

function parseMcpServerConfig(name: string, value: unknown): McpServerConfig {
  if (!isRecord(value)) {
    throw new Error(`Invalid MCP server configuration: ${name}`);
  }
  const {
    enabled,
    package: packageConfig,
    command,
    args,
    browser_engines,
    allowed_tools,
    normalize_url_arguments,
    evidence_tools,
  } = value;

  if (
    typeof enabled !== "boolean" ||
    !isRecord(packageConfig) ||
    packageConfig.manager !== "npm" ||
    typeof packageConfig.name !== "string" ||
    !/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(
      packageConfig.name,
    ) ||
    packageConfig.name.length > 214 ||
    typeof packageConfig.version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      packageConfig.version,
    ) ||
    !isSha512Integrity(packageConfig.integrity) ||
    typeof command !== "string" ||
    !command.trim() ||
    !isStringArray(args) ||
    (browser_engines !== undefined && !isBrowserEngineArray(browser_engines))
  ) {
    throw new Error(`Invalid MCP server configuration: ${name}`);
  }

  if (
    allowed_tools !== undefined &&
    allowed_tools !== null &&
    !isStringArray(allowed_tools)
  ) {
    throw new Error(`Invalid MCP server configuration: ${name}`);
  }
  if (
    normalize_url_arguments !== undefined &&
    !isStringRecord(normalize_url_arguments)
  ) {
    throw new Error(`Invalid MCP server configuration: ${name}`);
  }
  if (evidence_tools !== undefined && !isStringArray(evidence_tools)) {
    throw new Error(`Invalid MCP server configuration: ${name}`);
  }

  return {
    enabled,
    package: {
      manager: "npm",
      name: packageConfig.name,
      version: packageConfig.version,
      integrity: packageConfig.integrity,
    },
    command,
    args,
    browser_engines: browser_engines ?? [],
    allowed_tools: allowed_tools ?? null,
    normalize_url_arguments: normalize_url_arguments ?? {},
    evidence_tools: evidence_tools ?? [],
  };
}

export function validateToolConfiguration(value: unknown): ToolConfiguration {
  if (!isRecord(value) || !isRecord(value.mcp_servers)) {
    throw new Error(
      "Tool configuration must contain an 'mcp_servers' mapping.",
    );
  }

  const mcpServers: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(value.mcp_servers)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) {
      throw new Error(`Invalid MCP server configuration: ${name || "(empty)"}`);
    }
    mcpServers[name] = parseMcpServerConfig(name, server);
  }
  return { mcp_servers: mcpServers };
}

export function getToolConfiguration(): Promise<ToolConfiguration> {
  if (!configurationPromise) {
    configurationPromise = readConfigurationText()
      .then((contents) => validateToolConfiguration(parse(contents)))
      .catch((error: unknown) => {
        configurationPromise = undefined;
        throw error;
      });
  }
  return configurationPromise;
}
