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
├── server              # Backend server
├── sql                 # SQL stuff
└── web                 # Frontend web
    ├── public          # Public part of the web (favicon)
    └── src             # Source files
        ├── router      # Router
        ├── services    # Services
        ├── stores      # Scripts
        ├── types       # Types... for TYPEscript
        └── views       # Pages outside App.vue
```

## Getting Started

### Prerequisites

- Docker and Docker Compose
- A modern web browser

### Installation

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
