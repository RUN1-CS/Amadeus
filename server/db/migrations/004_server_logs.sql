CREATE TABLE IF NOT EXISTS server_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    logged_at TIMESTAMPTZ NOT NULL,
    level VARCHAR(10) NOT NULL,
    event VARCHAR(120) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS server_logs_logged_at_idx
    ON server_logs (logged_at);
