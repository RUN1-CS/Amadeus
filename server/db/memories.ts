// Memory records: encrypted CRUD. Similarity ranking lives in vector-search.ts.
import {
  decryptJsonValue,
  decryptUserValue,
  encryptJsonValue,
  encryptUserValue,
} from "../data-encryption.js";
import type {
  CreateMemoryParams,
  MemoryRow,
  UpdateMemoryParams,
} from "../types.js";
import { pool, requireUserDataKey } from "./pool.js";

export type EncryptedMemoryRow = Omit<
  MemoryRow,
  "content" | "source" | "metadata"
> & {
  content: string;
  source: string;
  metadata: string;
  embedding_ciphertext: string | null;
};

export function decryptMemoryRow(
  row: EncryptedMemoryRow,
  key: Buffer,
): MemoryRow {
  return {
    id: row.id,
    user_id: row.user_id,
    content: decryptUserValue(row.content, key),
    source: decryptUserValue(row.source, key),
    metadata: decryptJsonValue<Record<string, unknown>>(row.metadata, key),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Store the embedding for a chat message so it can be found by similarity search later.
export async function insertMessageMemory(
  userId: number,
  key: Buffer,
  params: {
    content: string;
    chatId: number;
    role: "user" | "assistant";
    model?: string;
    embedding: number[];
  },
) {
  const { content, chatId, role, model, embedding } = params;
  await pool.query(
    `INSERT INTO memories
     (user_id, content, source, metadata, embedding, embedding_ciphertext)
     VALUES ($1, $2, $3, $4::jsonb, NULL, $5)`,
    [
      userId,
      encryptUserValue(content, key),
      encryptUserValue("message", key),
      JSON.stringify(
        encryptJsonValue({ chatId, role, model: model ?? null }, key),
      ),
      encryptUserValue(JSON.stringify(embedding), key),
    ],
  );
}

// Fetch all memories for a specific user, ordered newest first.
export async function getMemoriesByUserId(
  userId: number,
): Promise<MemoryRow[]> {
  const text = `
    SELECT id, user_id, content, source, metadata, embedding_ciphertext,
           created_at, updated_at
    FROM memories
    WHERE user_id = $1
    ORDER BY created_at DESC;
  `;
  const { rows } = await pool.query<EncryptedMemoryRow>(text, [userId]);
  const key = await requireUserDataKey(userId);
  return rows.map((row) => decryptMemoryRow(row, key));
}

// Fetch a single memory by ID and user ID.
export async function getMemoryById(
  id: number,
  userId: number,
): Promise<MemoryRow | null> {
  const text = `
    SELECT id, user_id, content, source, metadata, embedding_ciphertext,
           created_at, updated_at
    FROM memories
    WHERE id = $1 AND user_id = $2;
  `;
  const { rows } = await pool.query<EncryptedMemoryRow>(text, [id, userId]);
  if (!rows[0]) return null;
  return decryptMemoryRow(rows[0], await requireUserDataKey(userId));
}

// Insert a new memory record.
export async function createMemory(
  params: CreateMemoryParams,
): Promise<MemoryRow> {
  const { userId, content, source, metadata = {}, embedding = null } = params;
  const key = await requireUserDataKey(userId);
  const text = `
    INSERT INTO memories
      (user_id, content, source, metadata, embedding, embedding_ciphertext)
    VALUES ($1, $2, $3, $4::jsonb, NULL, $5)
    RETURNING id, user_id, content, source, metadata, embedding_ciphertext,
              created_at, updated_at;
  `;
  const { rows } = await pool.query<EncryptedMemoryRow>(text, [
    userId,
    encryptUserValue(content, key),
    encryptUserValue(source, key),
    JSON.stringify(encryptJsonValue(metadata, key)),
    embedding ? encryptUserValue(JSON.stringify(embedding), key) : null,
  ]);
  return decryptMemoryRow(rows[0]!, key);
}

// Dynamically update a memory record.
export async function updateMemory(
  id: number,
  userId: number,
  params: UpdateMemoryParams,
): Promise<MemoryRow | null> {
  const key = await requireUserDataKey(userId);
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (params.content !== undefined) {
    fields.push(`content = $${idx++}`);
    values.push(encryptUserValue(params.content, key));
  }
  if (params.source !== undefined) {
    fields.push(`source = $${idx++}`);
    values.push(encryptUserValue(params.source, key));
  }
  if (params.metadata !== undefined) {
    fields.push(`metadata = $${idx++}::jsonb`);
    values.push(JSON.stringify(encryptJsonValue(params.metadata, key)));
  }
  if (params.embedding !== undefined) {
    fields.push(`embedding_ciphertext = $${idx++}`);
    values.push(
      params.embedding
        ? encryptUserValue(JSON.stringify(params.embedding), key)
        : null,
    );
    fields.push("embedding = NULL");
  }

  if (fields.length === 0) {
    return getMemoryById(id, userId);
  }

  fields.push(`updated_at = NOW()`);
  values.push(id, userId);

  const text = `
    UPDATE memories
    SET ${fields.join(", ")}
    WHERE id = $${idx++} AND user_id = $${idx++}
    RETURNING id, user_id, content, source, metadata, embedding_ciphertext,
              created_at, updated_at;
  `;

  const { rows } = await pool.query<EncryptedMemoryRow>(text, values);
  return rows[0] ? decryptMemoryRow(rows[0], key) : null;
}

// Delete a memory record by ID and user ID.
export async function deleteMemory(
  id: number,
  userId: number,
): Promise<boolean> {
  const text = `
    DELETE FROM memories
    WHERE id = $1 AND user_id = $2
    RETURNING id;
  `;
  const { rowCount } = await pool.query(text, [id, userId]);
  return (rowCount ?? 0) > 0;
}
