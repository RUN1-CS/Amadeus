// MCP adapter that exposes Playwright browser tools to the model.
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "ollama";

import { getErrorMessage } from "./errors.js";
import type { ToolExecution, ToolResult, McpTool } from "./types.js";

let clientPromise: Promise<Client> | undefined;

// Construct the MCP transport for the local Playwright browser process.
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

// Reuse a single MCP client connection so browser tool calls stay fast.
async function getClient() {
  if (!clientPromise) {
    const client = new Client({ name: "amadeus-chat", version: "1.0.0" });
    clientPromise = client.connect(createTransport()).then(() => client);
  }
  return clientPromise;
}

// Extract the plain text from a Playwright tool result while preserving errors.
export function extractToolText(result: unknown): ToolExecution {
  const toolResult = result as ToolResult;
  const text = (toolResult.content ?? [])
    .filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n")
    .slice(0, 12_000);
  return { ok: !toolResult.isError && text.trim().length > 0, text };
}

// Cleaner URL handling prevents Markdown-wrapped links from breaking browser navigation.
function normalizeUrl(value: string) {
  const markdownMatch = value.match(
    /^\s*\[[^\]]+\]\((https?:\/\/[^\s)]+)\)\s*$/i,
  );
  const candidate = (markdownMatch?.[1] ?? value).trim();
  return candidate.replace(/[),.;]+$/, "");
}

// Keep browser tool arguments consistent before they are sent to the MCP server.
function normalizeToolArguments(name: string, args: Record<string, unknown>) {
  if (name !== "browser_navigate" || typeof args.url !== "string") {
    return args;
  }
  return { ...args, url: normalizeUrl(args.url) };
}

// Expose the browser automation tools to Ollama as callable function definitions.
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

// Execute one browser tool call and return the text content in a model-friendly format.
export async function callPlaywrightTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  try {
    const client = await getClient();
    const normalizedArgs = normalizeToolArguments(name, args);
    console.log("[Playwright] call", name, normalizedArgs);
    const result = extractToolText(
      await client.callTool({ name, arguments: normalizedArgs }),
    );
    console.log("[Playwright] result", {
      name,
      ok: result.ok,
      characters: result.text.length,
      preview: result.text.slice(0, 240),
    });
    return result;
  } catch (error) {
    const message = getErrorMessage(error);
    console.error(`Could not call Playwright MCP tool ${name}:`, message);
    clientPromise = undefined;
    return { ok: false, text: `Playwright tool ${name} failed: ${message}` };
  }
}
