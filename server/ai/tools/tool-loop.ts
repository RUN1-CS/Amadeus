// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Runs chat rounds against Ollama and executes configured tool calls.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ChatResponse, Message, Tool, ToolCall } from "ollama";

import {
  keepAlive,
  maxToolErrorChars,
  maxToolResultChars,
  maxToolRounds,
  minEvidenceChars,
} from "../../config.js";
import { logger } from "../../logger.js";
import type { McpTool, ToolContent, ToolExecution } from "../../types.js";
import { ollama } from "../client.js";
import {
  getMcpServerDirectory,
  getToolConfiguration,
  type McpServerConfig,
} from "./tool-config.js";
import type { BuiltChatRequest } from "../request.js";

type ChunkHandler = (chunk: { content?: string; thinking?: string }) => void;

interface ToolRoute {
  serverName: string;
  toolName: string;
  config: McpServerConfig;
}

const clients = new Map<string, Promise<Client>>();
const toolRoutes = new Map<string, ToolRoute>();

function getClient(serverName: string, config: McpServerConfig) {
  let clientPromise = clients.get(serverName);
  if (!clientPromise) {
    const packageDirectory = getMcpServerDirectory(serverName);
    const client = new Client({ name: "amadeus-chat", version: "1.0.0" });
    clientPromise = client
      .connect(
        new StdioClientTransport({
          command: config.command,
          args: config.args.map((arg) =>
            arg.replaceAll("{package_dir}", packageDirectory),
          ),
          cwd: packageDirectory,
          stderr: "inherit",
        }),
      )
      .then(() => client);
    clients.set(serverName, clientPromise);
    void clientPromise.catch(() => clients.delete(serverName));
  }
  return clientPromise;
}

function getMcpTools(
  tools: McpTool[],
  serverName: string,
  config: McpServerConfig,
): Tool[] {
  const selectedTools =
    config.allowed_tools === null
      ? tools
      : tools.filter((tool) => config.allowed_tools?.includes(tool.name));

  return selectedTools.map((tool) => {
    const existingRoute = toolRoutes.get(tool.name);
    if (existingRoute && existingRoute.serverName !== serverName) {
      throw new Error(`Duplicate MCP tool name: ${tool.name}`);
    }
    toolRoutes.set(tool.name, { serverName, toolName: tool.name, config });
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description ?? "Use this configured tool.",
        parameters: (tool.inputSchema ?? {
          type: "object",
          properties: {},
        }) as Tool["function"]["parameters"],
      },
    };
  });
}

export async function getConfiguredTools(): Promise<Tool[]> {
  const configuration = await getToolConfiguration();
  const definitions: Tool[] = [];

  for (const [serverName, config] of Object.entries(
    configuration.mcp_servers,
  )) {
    if (!config.enabled) continue;
    try {
      const client = await getClient(serverName, config);
      const result = await client.listTools();
      definitions.push(
        ...getMcpTools(result.tools as McpTool[], serverName, config),
      );
    } catch (error) {
      logger.error(
        {
          event: "ai.tools_load_failed",
          serverName,
          errorType: error instanceof Error ? error.name : "Unknown",
        },
        "Could not load tools from MCP server",
      );
      clients.delete(serverName);
    }
  }
  return definitions;
}

function normalizeArguments(args: Record<string, unknown>, route: ToolRoute) {
  const urlArgument = route.config.normalize_url_arguments[route.toolName];
  const value = urlArgument ? args[urlArgument] : undefined;
  if (!urlArgument || typeof value !== "string") return args;

  const markdownMatch = value.match(
    /^\s*\[[^\]]+\]\((https?:\/\/[^\s)]+)\)[),.;]*\s*$/i,
  );
  const candidate = (markdownMatch?.[1] ?? value).trim();
  return { ...args, [urlArgument]: candidate.replace(/[),.;]+$/, "") };
}

function extractToolResult(result: unknown): ToolExecution {
  if (result === null || typeof result !== "object") {
    return { ok: false, text: "MCP server returned an invalid tool result." };
  }
  const response = result as {
    content?: ToolContent[];
    isError?: boolean;
  };
  const text = (response.content ?? [])
    .filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n")
    .slice(0, 12_000);
  return { ok: !response.isError && text.trim().length > 0, text };
}

async function executeConfiguredTool(
  name: string,
  args: Record<string, unknown>,
  availableTools: Tool[] | undefined,
): Promise<ToolExecution> {
  if (!availableTools?.some((tool) => tool.function.name === name)) {
    return { ok: false, text: `Tool ${name} is not configured.` };
  }

  const route = toolRoutes.get(name);
  if (!route) return { ok: false, text: `Tool ${name} is not configured.` };

  try {
    const client = await getClient(route.serverName, route.config);
    const startedAt = Date.now();
    const result = extractToolResult(
      await client.callTool({
        name: route.toolName,
        arguments: normalizeArguments(args, route),
      }),
    );
    logger.info({
      event: "ai.tool_call",
      serverName: route.serverName,
      ok: result.ok,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logger.error(
      {
        event: "ai.tool_call_failed",
        serverName: route.serverName,
        errorType: error instanceof Error ? error.name : "Unknown",
      },
      "Could not execute configured MCP tool",
    );
    clients.delete(route.serverName);
    return {
      ok: false,
      text: `Tool ${name} failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

function isEvidenceTool(name: string) {
  return [...toolRoutes.entries()].some(
    ([toolName, route]) =>
      toolName === name && route.config.evidence_tools.includes(route.toolName),
  );
}

async function runChatRound(
  request: BuiltChatRequest,
  messages: Message[],
  tools: Tool[] | undefined,
  onChunk?: ChunkHandler,
): Promise<ChatResponse> {
  const base = {
    model: request.model,
    messages,
    think: request.think,
    keep_alive: keepAlive,
    options: { num_ctx: request.contextWindow },
    ...(tools?.length ? { tools } : {}),
  };

  if (!request.stream || !onChunk) {
    return ollama.chat({ ...base, stream: false });
  }

  const stream = await ollama.chat({ ...base, stream: true });
  let content = "";
  let thinking = "";
  const toolCalls: ToolCall[] = [];
  let finalChunk: ChatResponse | undefined;

  for await (const chunk of stream) {
    finalChunk = chunk;
    const nextContent = chunk.message.content ?? "";
    const nextThinking = chunk.message.thinking ?? "";
    content += nextContent;
    thinking += nextThinking;
    if (chunk.message.tool_calls?.length) {
      toolCalls.push(...chunk.message.tool_calls);
    }
    if (nextContent || nextThinking) {
      onChunk({ content: nextContent, thinking: nextThinking });
    }
  }

  if (!finalChunk) {
    throw new Error("Ollama returned an empty response.");
  }
  return {
    ...finalChunk,
    message: {
      ...finalChunk.message,
      content,
      thinking,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
  };
}

export async function chatWithTools(
  request: BuiltChatRequest,
  onChunk?: ChunkHandler,
): Promise<ChatResponse> {
  const messages: Message[] = [...request.messages];
  let response = await runChatRound(request, messages, request.tools, onChunk);

  for (let round = 0; round < maxToolRounds; round += 1) {
    const toolCalls = response.message.tool_calls ?? [];
    if (toolCalls.length === 0) return response;

    messages.push(response.message);
    for (const toolCall of toolCalls) {
      const result = await executeConfiguredTool(
        toolCall.function.name,
        toolCall.function.arguments,
        request.tools,
      );
      messages.push({
        role: "tool",
        tool_name: toolCall.function.name,
        content: result.ok
          ? result.text.slice(0, maxToolResultChars)
          : `The tool did not return usable information. ${result.text.slice(0, maxToolErrorChars)}`,
      });

      if (
        isEvidenceTool(toolCall.function.name) &&
        result.ok &&
        result.text.trim().length >= minEvidenceChars
      ) {
        return runChatRound(request, messages, undefined, onChunk);
      }
    }

    response = await runChatRound(request, messages, request.tools, onChunk);
  }

  return response;
}
