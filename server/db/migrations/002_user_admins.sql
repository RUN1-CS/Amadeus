-- Admin membership is explicit and is removed when its user is deleted.
CREATE TABLE IF NOT EXISTS user_admins (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);
