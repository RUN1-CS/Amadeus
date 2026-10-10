import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "ollama";

import { getErrorMessage } from "./errors.js";

type ToolContent = { type?: string; text?: string };
type ToolResult = { content?: ToolContent[]; isError?: boolean };
type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

let clientPromise: Promise<Client> | undefined;

function createTransport() {
  const command = process.env.PLAYWRIGHT_MCP_COMMAND;
  if (command) {
    return new StdioClientTransport({
      command,
      args: (process.env.PLAYWRIGHT_MCP_ARGS ?? "").split(" ").filter(Boolean),
      stderr: "inherit",
    });
  }

  return new StdioClientTransport({
    command: process.execPath,
    args: [
      resolve("node_modules/@playwright/mcp/cli.js"),
      "--browser=firefox",
      "--headless",
    ],
    stderr: "inherit",
  });
}

async function getClient() {
  if (!clientPromise) {
    const client = new Client({ name: "amadeus-chat", version: "1.0.0" });
    clientPromise = client.connect(createTransport()).then(() => client);
  }
  return clientPromise;
}

export function extractToolText(result: unknown) {
  const toolResult = result as ToolResult;
  if (toolResult.isError) return "";
  return (toolResult.content ?? [])
    .filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n")
    .slice(0, 12_000);
}

export async function getPlaywrightTools(): Promise<Tool[]> {
  try {
    const client = await getClient();
    const result = await client.listTools();
    return result.tools.map((tool: McpTool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description:
          tool.description ?? "Use Playwright to interact with a web page.",
        parameters: (tool.inputSchema ?? {
          type: "object",
          properties: {},
        }) as Tool["function"]["parameters"],
      },
    }));
  } catch (error) {
    console.error(
      "Could not load Playwright MCP tools:",
      getErrorMessage(error),
    );
    clientPromise = undefined;
    return [];
  }
}

export async function callPlaywrightTool(
  name: string,
  args: Record<string, unknown>,
) {
  try {
    const client = await getClient();
    return extractToolText(await client.callTool({ name, arguments: args }));
  } catch (error) {
    console.error(
      `Could not call Playwright MCP tool ${name}:`,
      getErrorMessage(error),
    );
    clientPromise = undefined;
    return `Playwright tool ${name} failed: ${getErrorMessage(error)}`;
  }
}
