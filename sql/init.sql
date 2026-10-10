-- Extensions

CREATE EXTENSION IF NOT EXISTS vector;


-- Users

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    about_me TEXT NOT NULL DEFAULT '',
    custom_behavior TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chats

CREATE TABLE IF NOT EXISTS chats (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, user_id)
);

-- Messages

CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    chat_id INT NOT NULL,
    user_id INT NOT NULL,
    sender VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (chat_id, user_id)
        REFERENCES chats(id, user_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS messages_chat_created_idx
    ON messages (chat_id, created_at);

CREATE INDEX IF NOT EXISTS messages_user_created_idx
    ON messages (user_id, created_at);

-- Long-term Memories (RAG)

CREATE TABLE IF NOT EXISTS memories (
    id BIGSERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source VARCHAR(100) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    embedding VECTOR(768),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memories_user_idx
    ON memories (user_id);

CREATE INDEX IF NOT EXISTS memories_source_idx
    ON memories (source);

CREATE INDEX IF NOT EXISTS memories_embedding_idx
    ON memories USING hnsw (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL;

-- Sessions

CREATE TABLE IF NOT EXISTS sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx
    ON sessions (user_id);

CREATE INDEX IF NOT EXISTS sessions_expires_idx
    ON sessions (expires_at);