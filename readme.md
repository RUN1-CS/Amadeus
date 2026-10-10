# Amadeus Chat

A lightweight chat application built for local exploration and experimentation with AI-assisted conversations.

## Overview

This project provides a simple chat interface and supporting client/server logic for exchanging messages in a streamlined, developer-friendly setup. It is designed to be easy to run, easy to extend, and suitable for experimenting with conversational flows, prompts, and UI behavior.

## Features

- Clean chat experience with a minimal user interface
- Message-based interaction flow
- Easy local setup for development
- Extensible structure for adding new chat capabilities
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

The project does not use a `.env` file. Configure API endpoints, ports, and model/provider settings through the Docker Compose configuration or the relevant application configuration files.

## Contributing

Contributions are welcome. For small changes, open a pull request with a clear description of the update. For larger changes, consider discussing the design and architecture before implementation.

## License

This project is provided as-is for learning, experimentation, and development purposes.

## Notes

This project is intentionally modular and easy to adapt. If you are using it as a foundation for a production chat experience, review security, authentication, and deployment considerations before exposing it publicly.
