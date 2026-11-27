# Amadeus Chat

A lightweight chat application built for local exploration and experimentation with AI-assisted conversations.

## Overview

This project provides a simple chat interface and supporting client/server logic for exchanging messages in a streamlined, developer-friendly setup. It is designed to be easy to run, easy to extend, and suitable for experimenting with conversational flows, prompts, and UI behavior.

## Features

- Clean chat experience with a minimal user interface
- Message-based interaction flow
- Easy local setup for development
- Extensible structure for adding new chat capabilities
- ComfyUI image generation with selectable checkpoints, positive prompts, and negative prompts
- Suitable for prototyping and experimentation

## Project Structure

```text
Amadeus/
├── models/                  # Local AI models
├── output/                  # Generated output
│
├── server/                   # Backend (Node.js + TypeScript)
│   ├── classes/              # Shared classes
│   ├── db/                   # Database layer
│   │   └── migrations/       # SQL schema migrations
│   ├── http/                 # HTTP route handlers
│   ├── ai/                   # AI model integration
│   ├── ai.ts                 # AI model management
│   ├── backups.ts            # Database backup management
│   ├── comfyui.ts            # ComfyUI integration
│   ├── config.ts             # Environment and server configuration
│   ├── data-encryption.ts    # User data encryption
│   ├── logger.ts             # Application logging
│   ├── protocol.ts           # Communication protocol
│   ├── websocket.ts          # WebSocket communication
│   └── index.ts              # Backend entry point
│
├── web/                      # Frontend (Vue + TypeScript)
│   ├── public/               # Static assets
│   └── src/
│       ├── components/       # Reusable UI components
│       │   ├── admin/        # Administration panels
│       │   ├── chat/         # Chat interface components
│       │   └── common/       # Shared components
│       ├── composables/      # Reusable Vue composition logic
│       ├── locales/          # Localization
│       ├── router/           # Application routing
│       ├── services/         # API and frontend services
│       ├── stores/           # Pinia state management
│       │   └── ollama/       # Ollama store files
│       ├── types/            # Frontend TypeScript definitions
│       ├── views/            # Application pages
│       ├── App.vue           # Root Vue component
│       └── main.ts           # Frontend entry point
│
├── API.md                    # API documentation
├── compose.yml               # Docker Compose configuration
├── .env.example              # Environment configuration template
├── LICENSE
└── readme.md
```

## Getting Started

### Prerequisites

- Docker and Docker Compose
- A modern web browser

### Installation

Create the ignored runtime tool configuration from its example before starting
the server:

```bash
cp server/ai/tools/tools.example.yml server/ai/tools/tools.yml
```

The server loads `server/ai/tools/tools.yml` at startup; Docker Compose mounts it
read-only into the server container. Restart the server after changing it.
Configure MCP servers under `mcp_servers`; each enabled server defines its
package manager, exact package version and integrity, command, arguments,
allowed tool names, and optional tool-loop behavior. `npm` is currently the
only supported package manager. On startup, the installer uses the public npm
registry, installs enabled packages into an isolated `.mcp-tools` directory,
disables package lifecycle scripts, and verifies the installed package against
the configured SHA-512 integrity value before starting MCP servers. Matching
packages are reused on subsequent starts; package changes trigger a reinstall.
Set `allowed_tools` to a list to restrict tools, or leave it `null` to expose
all tools reported by that MCP server. The example uses Playwright MCP, while
the tool loader and dispatcher work with any MCP server using stdio transport.
For browser integrations, `browser_engines` can request a supported browser;
Playwright then installs the browser and required OS packages during startup.
This optional setup requires network access and a container user with permission
to install system packages, and can delay the server becoming healthy on its
first start. The server healthcheck allows five minutes by default; adjust
`SERVER_HEALTHCHECK_START_PERIOD` in `.env` if setup takes longer. Set the
server's `enabled` value to `false` to skip package and browser installation.
Treat this configuration as privileged: enabled MCP packages and their
configured commands execute inside the server container.

Build and start the application with Docker Compose:

```bash
docker compose up --build
```

### Development

The application runs inside Docker. Start the development services with:

```bash
docker compose up
```

Then open the local URL shown in the terminal.

## Scripts

Common Docker commands include:

```bash
docker compose up --build
docker compose down
docker compose logs -f
```

## Configuration

Copy `.env.example` to `.env` and set the required database and ComfyUI web credentials.
Generate `DATA_ENCRYPTION_KEY` with `openssl rand -base64 32`; keep it stable
and secret, because losing or changing it makes encrypted user data unavailable.
Set `VITE_NOVELTY=true` in `.env` to include the novelty languages in the web
language selector. This is applied during the web image build, so rebuild the
web service after changing it with `docker compose up --build web`.
The server connects to ComfyUI through `COMFYUI_BASE_URL` (the Compose default is
`http://comfyui:8188`). `COMFYUI_NEGATIVE_PROMPT` provides the administrator's
negative prompt for administration purposes; the user can still add some.

Set `SERVER_BIND_ADDRESS` in `.env` to control which host interfaces publish the
server port. Use `0.0.0.0` (the default) to allow LAN connections, or
`127.0.0.1` to make the port accessible only from the host machine. Keep
`SERVER_PORT` to choose the host port. Recreate the service after changing the
setting with `docker compose up -d`.
This controls direct access to the server's published port. `WEB_PORT` is a
separate port and the web service proxies `/api` requests to the server; bind
the web port to localhost as well if you also want to prevent LAN access to the
API through that proxy.

Server logs are structured JSON written to standard output by Pino. Set
`LOG_LEVEL` to `fatal`, `error`, `warn`, `info` (default), `debug`, or `trace` to
adjust verbosity. The same events are stored in the `server_logs` PostgreSQL
table and deleted after 30 days. Persisted records include only the log level,
timestamp, event name, and an allowlist of operational metadata; request bodies,
chat content, credentials, tokens, and browser tool arguments/results are not
stored.

## Server API

See [API.md](./API.md) for the HTTP and WebSocket endpoint reference, including
authentication, request/response schemas, upload behavior, and examples.

The chat composer always shows the ComfyUI checkpoint selector. The selected chat
model decides whether each request is ordinary conversation or image generation.
For image requests it extracts and improves the positive prompt, separates negative
prompt terms, and sends the result to ComfyUI. The user only needs to describe what
they want naturally.

## Contributing

Contributions are welcome. For small changes, open a pull request with a clear description of the update. For larger changes, consider discussing the design and architecture before implementation.

## License

This project is provided as-is for learning, experimentation, and development purposes.

## Notes

This project is intentionally modular and easy to adapt. If you are using it as a foundation for a production chat experience, review security, authentication, and deployment considerations before exposing it publicly.
