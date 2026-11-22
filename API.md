# Amadeus Server API

This document describes the HTTP and WebSocket APIs exposed by the Amadeus
server. The default server port is `8080` (configured with `PORT`).
With Docker Compose, `SERVER_PORT` selects the host port and
`SERVER_BIND_ADDRESS` selects the host interface: `0.0.0.0` exposes the server
port to the LAN, while `127.0.0.1` restricts it to the host machine.

Base HTTP URL:

```text
http://localhost:8080
```

The browser API client derives the host from
`window.location.hostname` and uses port `8080`.

## Conventions

- JSON requests and responses use `Content-Type: application/json; charset=utf-8`.
- Protected endpoints require an active bearer session token:

  ```http
  Authorization: Bearer <session-token>
  ```

- Session tokens are random 64-character hexadecimal values. They are stored
  in PostgreSQL and expire 30 days after issuance.
- Successful protected operations return JSON objects containing one of the
  documented resource fields.
- Errors have this shape:

  ```json
  {
    "error": "Human-readable error message."
  }
  ```

- CORS permits every origin and the `Authorization` and `Content-Type` headers.
- `OPTIONS` requests receive `204` with an empty JSON body.
- Unmatched routes receive `404 {"error":"Not found."}`.
- Database and upstream-service failures generally receive `500`.
- Duplicate usernames receive `409`.

### Public user

Authentication responses and account responses use this shape:

```json
{
  "id": 1,
  "username": "example",
  "aboutMe": "",
  "customBehavior": "",
  "isAdmin": false
}
```

`aboutMe` and `customBehavior` are plain text fields used to personalize model
requests.

---

## REST API

### Register

```http
POST /api/auth/register
```

Creates a user and immediately creates a session.

Request:

```json
{
  "username": "example",
  "password": "at-least-8"
}
```

Rules:

- `username` must be a non-empty string.
- `password` must contain at least 8 characters.
- The username is trimmed and stored in lowercase.

Responses:

- `201`:

  ```json
  {
    "user": {
      "id": 1,
      "username": "example",
      "aboutMe": "",
      "customBehavior": "",
      "isAdmin": false
    },
    "token": "<session-token>"
  }
  ```

- `400` for missing/invalid credentials.
- `409` if the username already exists.

### Log in

```http
POST /api/auth/login
```

Request:

```json
{
  "username": "example",
  "password": "at-least-8"
}
```

Responses:

- `200`:

  ```json
  {
    "user": {
      "id": 1,
      "username": "example",
      "aboutMe": "",
      "customBehavior": "",
      "isAdmin": false
    },
    "token": "<session-token>"
  }
  ```

- `401 {"error":"Invalid username or password."}`

Each successful login creates a new session token; login does not revoke older
sessions.

### Get the current user

```http
GET /api/auth/me
Authorization: Bearer <session-token>
```

Response: `200`

```json
{
  "user": {
    "id": 1,
    "username": "example",
    "aboutMe": "",
    "customBehavior": "",
    "isAdmin": false
  }
}
```

This route returns `401 {"error":"Authentication required."}` if the token is
missing, unknown, or expired.

### Admin overview

```http
GET /api/admin/overview
Authorization: Bearer <session-token>
```

Returns application-wide account, conversation, message, and memory counts,
the eight most recently registered usernames, and the latest cached Ollama and
ComfyUI model-discovery status. The route requires an active session and an
entry for the user in `user_admins`; other signed-in users receive `403`.

Admin membership is not assigned automatically. After the `002_user_admins.sql`
migration has run, grant membership to a known account with:

```sql
INSERT INTO user_admins (user_id)
SELECT id FROM users WHERE username = 'example';
```

The `isAdmin` property in public user responses reflects current membership.

### Update the account

```http
PATCH /api/auth/account
Authorization: Bearer <session-token>
Content-Type: application/json
```

Request:

```json
{
  "username": "new-name",
  "currentPassword": "current-password",
  "newPassword": "new-password-at-least-8",
  "aboutMe": "A short description.",
  "customBehavior": "Reply briefly."
}
```

`username`, `currentPassword`, `aboutMe`, and `customBehavior` must be supplied
as strings. `newPassword` is optional; when present, it must contain at least
8 characters.

Responses:

- `200` with `{ "user": <PublicUser> }`.
- `400` if required fields or the new password are invalid.
- `401 {"error":"Current password is incorrect."}`.
- `409` if the new username is already taken.

---

## Chats

All chat routes require an active bearer session. Chat operations and message
history are restricted to chats owned by the authenticated user.

### List chats

```http
GET /api/chats
```

Response: `200`

```json
{
  "chats": [
    {
      "id": 12,
      "title": "Conversation title",
      "createdAt": "2026-11-21T19:15:00.000Z"
    }
  ]
}
```

Chats are ordered newest first.

### Create a chat

```http
POST /api/chats
Content-Type: application/json
```

Request:

```json
{
  "title": "Optional title"
}
```

An omitted, empty, or non-string title is stored as `New conversation`.

Response: `201`

```json
{
  "chatId": 12
}
```

### Rename a chat

```http
PATCH /api/chats/:chatId
Content-Type: application/json
```

Request:

```json
{
  "title": "A new title"
}
```

The title is trimmed and must not be empty.

Responses:

- `200`: `{ "chat": { "id": 12, "title": "A new title", "createdAt": "..." } }`
- `400 {"error":"Chat name cannot be empty."}`
- `404 {"error":"Chat not found."}`

### Delete a chat

```http
DELETE /api/chats/:chatId
```

Responses:

- `200 {"deleted":true}`
- `404 {"error":"Chat not found."}`

Deleting a chat also deletes its messages.

### Get chat messages

```http
GET /api/chats/:chatId/messages
```

Response: `200`

```json
{
  "messages": [
    {
      "id": 31,
      "role": "user",
      "content": "Hello",
      "createdAt": "2026-11-21T19:16:00.000Z",
      "attachments": []
    },
    {
      "id": 32,
      "role": "assistant",
      "content": "Hello! How can I help?",
      "model": "llama3",
      "createdAt": "2026-11-21T19:16:03.000Z",
      "attachments": []
    }
  ]
}
```

Messages are returned oldest first. `model` is omitted for user messages and
contains the model name or ComfyUI generative model for image responses.

### Upload chat attachments

```http
POST /api/chats/:chatId/upload
Content-Type: multipart/form-data
```

Send files in a multipart field named `files`. Multiple files are supported.
The request body limit is 10 MB in aggregate.

Example:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  -F "files=@notes.pdf" \
  -F "files=@photo.png" \
  http://localhost:8080/api/chats/12/upload
```

Response: `200`

```json
{
  "files": [
    {
      "name": "notes.pdf",
      "kind": "pdf",
      "content": "Extracted PDF text"
    },
    {
      "name": "photo.png",
      "kind": "image",
      "data": "<base64-encoded image>"
    },
    {
      "name": "notes.txt",
      "kind": "file",
      "content": "Decoded text"
    }
  ]
}
```

Classification rules:

- PDF files are detected by MIME type or a `.pdf` extension.
- Images are detected by an `image/*` MIME type and returned as base64.
- Other files are treated as text and returned as UTF-8 text.
- Extracted PDF text is limited to 50,000 characters.

Responses:

- `404 {"error":"Chat not found."}` for an unknown chat or one not owned by the
  authenticated user.
- `500` for invalid multipart boundaries or an upload larger than 10 MB.

---

## Memories

All memory routes require authentication. Each memory belongs to the signed-in
user.

Memory shape:

```json
{
  "id": 5,
  "user_id": 1,
  "content": "The user prefers concise answers.",
  "source": "manual",
  "metadata": {},
  "created_at": "2026-11-21T19:20:00.000Z",
  "updated_at": "2026-11-21T19:20:00.000Z"
}
```

The embedding field is not returned by the REST memory routes.

### List memories

```http
GET /api/memories
```

Response: `200`

```json
{
  "memories": [<Memory>, "..."]
}
```

Memories are ordered newest first.

### Create a memory

```http
POST /api/memories
Content-Type: application/json
```

Request:

```json
{
  "content": "The user prefers concise answers.",
  "source": "manual",
  "metadata": {
    "category": "preference"
  }
}
```

`content` is trimmed and cannot be empty. `source` defaults to `manual`.
`metadata` must be an object and defaults to `{}`.

Response: `201`

```json
{
  "memory": <Memory>
}
```

### Update a memory

```http
PATCH /api/memories/:memoryId
Content-Type: application/json
```

Request fields are optional:

```json
{
  "content": "Updated content",
  "source": "manual",
  "metadata": {
    "category": "updated"
  }
}
```

Content is trimmed when supplied. Source and metadata are not otherwise
normalized.

Responses:

- `200 {"memory":<Memory>}`
- `404 {"error":"Memory not found."}`

### Delete a memory

```http
DELETE /api/memories/:memoryId
```

Responses:

- `200 {"deleted":true}`
- `404 {"error":"Memory not found."}`

> Implementation note: the standalone memory store currently sends `PUT` for
> updates, but the server implements updates at `PATCH`. A `PUT` request
> therefore falls through to `404 {"error":"Not found."}` until the client or
> server route is aligned.

---

## ComfyUI

Both ComfyUI routes require authentication.

### List checkpoints

```http
GET /api/comfy/models
```

Response: `200`

```json
{
  "models": ["model-one.safetensors", "model-two.safetensors"],
  "defaultNegativePrompt": "blurry, low quality",
  "error": "Optional last load error"
}
```

`error` is omitted when no load error is present. The server caches this list.
If the cache is empty, requesting it retries loading from ComfyUI.

### Fetch a generated image

```http
GET /api/comfy/image?filename=<name>&subfolder=<subfolder>&type=<type>
```

Query parameters:

| Parameter   | Required | Description                                            |
| ----------- | -------- | ------------------------------------------------------ |
| `filename`  | yes      | ComfyUI output filename. Must not contain `/` or `\\`. |
| `subfolder` | no       | ComfyUI subfolder. May be empty.                       |
| `type`      | no       | `output`, `input`, or `temp`; defaults to `output`.    |

Success returns the upstream image bytes with `200` and the upstream
`Content-Type` (typically `image/png`). The response is cached privately by
browsers for one hour.

Invalid references receive:

```json
{
  "error": "Invalid ComfyUI image reference."
}
```

with status `400`.

ComfyUI and image-view failures are returned as `500` JSON errors because this
route goes through the HTTP dispatcher's catch handler.

---

## WebSocket API

The WebSocket endpoint is hosted on the same server and port as the HTTP API:

```text
ws://localhost:8080
```

Every client payload is a JSON object. Before sending chat operations, the
socket must authenticate.

### Authenticate

Client:

```json
{
  "type": "authenticate",
  "token": "<session-token>"
}
```

Success server response:

```json
{
  "type": "authenticated",
  "user": {
    "id": 1,
    "username": "example",
    "aboutMe": "",
    "customBehavior": ""
  }
}
```

An unknown or expired token produces:

```json
{
  "type": "error",
  "error": "Authentication required."
}
```

followed by a `{ "type": "done" }` event.

### Fetch Ollama models

Client:

```json
{
  "type": "fetch_models"
}
```

Server:

```json
{
  "type": "models",
  "models": ["model-one", "model-two"]
}
```

If Ollama failed during startup or model loading, the server also sends:

```json
{
  "type": "error",
  "error": "<last Ollama load error>"
}
```

### Send a chat message

Client:

```json
{
  "type": "message",
  "chatId": 12,
  "model": "llama3",
  "prompt": "Explain the difference between TCP and UDP.",
  "images": ["<base64 image>"],
  "attachments": [
    {
      "name": "photo.png",
      "kind": "image"
    }
  ],
  "generativeModel": "model-one.safetensors",
  "tsundere": false,
  "thinking": true,
  "stream": true
}
```

`chatId`, `model`, and `prompt` have the following roles:

- `chatId` identifies an owned chat and is required.
- `model` selects the Ollama model.
- `prompt` contains the text to send to the model.
- `images` contains base64 image data for image-capable Ollama models.
- `attachments` describe files already uploaded through the chat upload route.
- `generativeModel` identifies a ComfyUI checkpoint when image generation is
  selected or inferred.
- `tsundere`, `thinking`, and `stream` affect the chat request behavior.

Streaming responses contain partial message events:

```json
{
  "type": "message",
  "message": {
    "content": "TCP",
    "thinking": ""
  }
}
```

The final event has `full: true`:

```json
{
  "type": "message",
  "message": {
    "content": "TCP is...",
    "thinking": ""
  },
  "full": true
}
```

The server then sends:

```json
{
  "type": "done"
}
```

If this is the first message in a chat, the server may replace the chat title
and emit:

```json
{
  "type": "chat_title",
  "chat": {
    "id": 12,
    "title": "Generated title",
    "createdAt": "..."
  }
}
```

Both user and assistant messages are persisted. Assistant embeddings and
recent-message similarity searches are used for memory context. Title
generation failures do not fail the chat.

### Generate an image directly

Client:

```json
{
  "type": "generate_image",
  "chatId": 12,
  "prompt": "A red fox in a snowy forest",
  "positivePrompt": "A red fox in a snowy forest",
  "negativePrompt": "blurry",
  "generativeModel": "model-one.safetensors"
}
```

`positivePrompt` is preferred; `prompt` is used as a fallback. The server adds
the configured default ComfyUI negative prompt and the supplied negative prompt.

It saves both a user message and an assistant message, then sends:

```json
{
  "type": "message",
  "message": {
    "content": "Generated image",
    "attachments": [
      {
        "name": "amadeus_x.png",
        "kind": "image",
        "url": "/api/comfy/image?filename=amadeus_x.png&subfolder=&type=output"
      }
    ]
  },
  "full": true
}
```

followed by `{ "type": "done" }`.

If image generation is not explicitly requested, the server can infer it from
the ordinary `message` flow and return the same image events.

### WebSocket errors

For invalid chat IDs or an operation failure, the server sends:

```json
{
  "type": "error",
  "error": "Human-readable error."
}
```

It then sends `{ "type": "done" }` for that operation.

---

## Request and response examples

### Login and list chats

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"example","password":"at-least-8"}' \
  | jq -r '.token')

curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/chats
```

### Create and rename a chat

```bash
CHAT_ID=$(curl -s -X POST http://localhost:8080/api/chats \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Documentation"}' \
  | jq -r '.chatId')

curl -X PATCH "http://localhost:8080/api/chats/$CHAT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"API notes"}'
```
