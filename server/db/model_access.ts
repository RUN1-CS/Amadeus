// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Per-model enable/disable switches for Ollama and ComfyUI models.
import { AiModelType } from "../types.js";
import { pool } from "./pool.js";

// Missing model-access records mean the model is enabled by default.
export async function getAiModelAccess(
  modelType: AiModelType,
  modelNames: string[],
) {
  if (!modelNames.length) return [];
  const result = await pool.query<{ model_name: string; enabled: boolean }>(
    `SELECT model_name, enabled FROM ai_model_access
     WHERE model_type = $1 AND model_name = ANY($2::text[])`,
    [modelType, modelNames],
  );
  const states = new Map(
    result.rows.map((row) => [row.model_name, row.enabled]),
  );
  return modelNames.map((name) => ({
    name,
    enabled: states.get(name) ?? true,
  }));
}

export async function isAiModelEnabled(
  modelType: AiModelType,
  modelName: string,
): Promise<boolean> {
  const result = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM ai_model_access
     WHERE model_type = $1 AND model_name = $2`,
    [modelType, modelName],
  );
  return result.rows[0]?.enabled ?? true;
}

export async function setAiModelEnabled(
  modelType: AiModelType,
  modelName: string,
  enabled: boolean,
) {
  await pool.query(
    `INSERT INTO ai_model_access (model_type, model_name, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (model_type, model_name)
     DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    [modelType, modelName, enabled],
  );
}
