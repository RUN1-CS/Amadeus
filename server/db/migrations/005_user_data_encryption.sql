-- SPDX-License-Identifier: GPL-3.0-or-later
-- Copyright (C) 2026 RUN1-CS

ALTER TABLE users ALTER COLUMN username TYPE TEXT;
ALTER TABLE users ALTER COLUMN password_hash TYPE TEXT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_lookup TEXT;

ALTER TABLE chats ALTER COLUMN title TYPE TEXT;

ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding_ciphertext TEXT;
DROP INDEX IF EXISTS memories_embedding_idx;

-- Backups exclude this table; no FK lets pg_restore replace users while
-- preserving keys for accounts that still exist.
CREATE TABLE IF NOT EXISTS user_data_keys (
    user_id BIGINT PRIMARY KEY,
    wrapped_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_encryption_manifest (
    version INTEGER PRIMARY KEY
);
INSERT INTO data_encryption_manifest (version) VALUES (1)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS encryption_migrations (
    version TEXT PRIMARY KEY,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lookup_idx
    ON users (username_lookup)
    WHERE username_lookup IS NOT NULL;
