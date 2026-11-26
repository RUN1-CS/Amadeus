// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";
import { logger } from "../../logger.js";

export interface McpServerConfig {
  enabled: boolean;
  command: string;
  args: string[];
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

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && "code" in error && error.code === "ENOENT";
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
    command,
    args,
    allowed_tools,
    normalize_url_arguments,
    evidence_tools,
  } = value;

  if (
    typeof enabled !== "boolean" ||
    typeof command !== "string" ||
    !command.trim() ||
    !isStringArray(args)
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
    command,
    args,
    allowed_tools: allowed_tools ?? null,
    normalize_url_arguments: normalize_url_arguments ?? {},
    evidence_tools: evidence_tools ?? [],
  };
}

function validateConfiguration(value: unknown): ToolConfiguration {
  if (!isRecord(value) || !isRecord(value.mcp_servers)) {
    throw new Error(
      "Tool configuration must contain an 'mcp_servers' mapping.",
    );
  }

  const mcpServers: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(value.mcp_servers)) {
    if (!name) {
      throw new Error(`Invalid MCP server configuration: ${name || "(empty)"}`);
    }
    mcpServers[name] = parseMcpServerConfig(name, server);
  }
  return { mcp_servers: mcpServers };
}

export function getToolConfiguration(): Promise<ToolConfiguration> {
  if (!configurationPromise) {
    configurationPromise = readConfigurationText()
      .then((contents) => validateConfiguration(parse(contents)))
      .catch((error: unknown) => {
        configurationPromise = undefined;
        throw error;
      });
  }
  return configurationPromise;
}
