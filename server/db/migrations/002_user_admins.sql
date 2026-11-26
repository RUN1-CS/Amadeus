-- SPDX-License-Identifier: GPL-3.0-or-later
-- Copyright (C) 2026 RUN1-CS

-- Admin membership is explicit and is removed when its user is deleted.
CREATE TABLE IF NOT EXISTS user_admins (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

-- The first user is admin by default.
INSERT INTO user_admins (user_id, granted_at, granted_by)
SELECT id, NOW(), NULL FROM users WHERE id = 1
ON CONFLICT (user_id) DO NOTHING;