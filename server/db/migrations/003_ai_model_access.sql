-- SPDX-License-Identifier: GPL-3.0-or-later
-- Copyright (C) 2026 RUN1-CS

CREATE TABLE IF NOT EXISTS ai_model_access (
    model_type VARCHAR(20) NOT NULL CHECK (model_type IN ('ollama', 'comfyui')),
    model_name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (model_type, model_name)
);
