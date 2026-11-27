// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

const mocks = vi.hoisted(() => ({
  listTools: vi.fn(),
  callTool: vi.fn(),
  connect: vi.fn(),
  chat: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect(transport: unknown) {
      return mocks.connect(transport);
    }

    listTools() {
      return mocks.listTools();
    }

    callTool(request: unknown) {
      return mocks.callTool(request);
    }
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    constructor(public options: unknown) {}
  },
}));
vi.mock("../ai/client.js", () => ({ ollama: { chat: mocks.chat } }));

import { chatWithTools, getConfiguredTools } from "../ai/tools/tool-loop.js";
import { validateToolConfiguration } from "../ai/tools/tool-config.js";

let temporaryDirectory: string | undefined;
let originalConfigPath: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
  if (originalConfigPath === undefined) {
    delete process.env.TOOLS_CONFIG_PATH;
  } else {
    process.env.TOOLS_CONFIG_PATH = originalConfigPath;
  }
});

describe("configured MCP tool loop", () => {
  it("accepts an empty MCP server mapping", async () => {
    const configuration = validateToolConfiguration(parse("mcp_servers: {}"));

    expect(configuration).toEqual({ mcp_servers: {} });
  });

  it("accepts the checked-in declarative package example", async () => {
    const example = await readFile("ai/tools/tools.example.yml", "utf8");
    const configuration = validateToolConfiguration(parse(example));

    expect(configuration.mcp_servers.playwright.package).toEqual({
      manager: "npm",
      name: "@playwright/mcp",
      version: "0.0.86",
      integrity:
        "sha512-4SL9OSINmik3+EObCYJIxH8BkhcqqGU6CM8XIgztW015iBVR9WR6Q0xF180Ery+xuEVyyK5r6nC2bOg3zjgCoA==",
    });
  });

  it("discovers and executes configured tools with YAML behavior", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "amadeus-tools-"));
    originalConfigPath = process.env.TOOLS_CONFIG_PATH;
    const configPath = join(temporaryDirectory, "tools.yml");
    process.env.TOOLS_CONFIG_PATH = configPath;
    await writeFile(
      configPath,
      [
        "mcp_servers:",
        "  records:",
        "    enabled: true",
        "    package:",
        "      manager: npm",
        "      name: '@example/mcp-records'",
        "      version: '1.2.3'",
        "      integrity: 'sha512-4SL9OSINmik3+EObCYJIxH8BkhcqqGU6CM8XIgztW015iBVR9WR6Q0xF180Ery+xuEVyyK5r6nC2bOg3zjgCoA=='",
        "    command: record-mcp",
        "    args: []",
        "    browser_engines: []",
        "    allowed_tools:",
        "      - open_page",
        "      - lookup_record",
        "    normalize_url_arguments:",
        "      open_page: url",
        "    evidence_tools:",
        "      - lookup_record",
      ].join("\n"),
    );

    mocks.connect.mockResolvedValue(undefined);
    mocks.listTools.mockResolvedValue({
      tools: [
        {
          name: "open_page",
          description: "Open a page",
          inputSchema: {
            type: "object",
            properties: { url: { type: "string" } },
          },
        },
        {
          name: "lookup_record",
          description: "Look up a record",
          inputSchema: { type: "object", properties: {} },
        },
        { name: "hidden_tool", inputSchema: { type: "object" } },
      ],
    });

    const tools = await getConfiguredTools();
    expect(tools.map((tool) => tool.function.name)).toEqual([
      "open_page",
      "lookup_record",
    ]);

    mocks.callTool
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Opened page." }],
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Record data ".repeat(50) }],
      });
    mocks.chat
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function: {
                name: "open_page",
                arguments: { url: "[Example](https://example.com)." },
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function: {
                name: "lookup_record",
                arguments: {},
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        message: { role: "assistant", content: "Here is the result." },
      });

    const request = {
      model: "test-model",
      messages: [],
      think: false,
      stream: false,
      contextWindow: 2048,
      tools,
    };
    await chatWithTools(request as never);

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.connect.mock.calls[0][0].options).toMatchObject({
      command: "record-mcp",
      args: [],
      cwd: expect.stringContaining(".mcp-tools/records"),
    });
    expect(mocks.callTool).toHaveBeenNthCalledWith(1, {
      name: "open_page",
      arguments: { url: "https://example.com" },
    });
    expect(mocks.callTool).toHaveBeenNthCalledWith(2, {
      name: "lookup_record",
      arguments: {},
    });
    expect(mocks.chat.mock.calls[2][0]).not.toHaveProperty("tools");
  });

  it("rejects unpinned package versions and unsupported managers", () => {
    const config = {
      mcp_servers: {
        records: {
          enabled: true,
          package: {
            manager: "npm",
            name: "@example/mcp-records",
            version: "latest",
            integrity:
              "sha512-4SL9OSINmik3+EObCYJIxH8BkhcqqGU6CM8XIgztW015iBVR9WR6Q0xF180Ery+xuEVyyK5r6nC2bOg3zjgCoA==",
          },
          command: "node",
          args: [],
        },
      },
    };

    expect(() => validateToolConfiguration(config)).toThrow(
      "Invalid MCP server configuration: records",
    );
    config.mcp_servers.records.package.version = "1.2.3";
    config.mcp_servers.records.package.manager = "shell";
    expect(() => validateToolConfiguration(config)).toThrow(
      "Invalid MCP server configuration: records",
    );
  });
});
