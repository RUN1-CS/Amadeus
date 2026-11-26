// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Similarity search over encrypted memory embeddings (decrypted and ranked in-process).
import { decryptJsonValue, decryptUserValue } from "../data-encryption.js";
import type { MemoryRow, SimilarMessage } from "../types.js";
import { pool, requireUserDataKey } from "./pool.js";
import { decryptMemoryRow, type EncryptedMemoryRow } from "./memories.js";

function cosineSimilarity(left: number[], right: number[]) {
  const size = Math.min(left.length, right.length);
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = 0; index < size; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftLength += leftValue * leftValue;
    rightLength += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftLength * rightLength);
  return denominator === 0 ? 0 : dot / denominator;
}

async function rankEncryptedMemories(
  userId: number,
  queryVector: number[],
  limit: number,
  messagesOnly: boolean,
) {
  const key = await requireUserDataKey(userId);
  const batchSize = 250;
  const ranked: {
    memory: MemoryRow;
    role: "user" | "assistant";
    similarity: number;
  }[] = [];
  let afterId = "0";

  while (true) {
    const result = await pool.query<EncryptedMemoryRow>(
      `SELECT id, user_id, content, source, metadata, embedding_ciphertext,
              created_at, updated_at
       FROM memories
       WHERE user_id = $1 AND id > $2::bigint
         AND embedding_ciphertext IS NOT NULL
       ORDER BY id ASC
       LIMIT $3`,
      [userId, afterId, batchSize],
    );
    if (result.rows.length === 0) break;
    afterId = String(result.rows.at(-1)!.id);

    for (const row of result.rows) {
      const source = decryptUserValue(row.source, key);
      if (messagesOnly && source !== "message") continue;
      const metadata = decryptJsonValue<{ role?: string }>(row.metadata, key);
      const vector = JSON.parse(
        decryptUserValue(row.embedding_ciphertext!, key),
      ) as number[];
      ranked.push({
        memory: decryptMemoryRow(row, key),
        role: metadata.role === "user" ? "user" : "assistant",
        similarity: cosineSimilarity(queryVector, vector),
      });
    }

    ranked.sort((left, right) => right.similarity - left.similarity);
    if (ranked.length > limit) ranked.length = limit;
  }

  return ranked;
}

// Find memories closest to the current prompt to give the model useful context.
export async function searchSimilarMessages(
  userId: number,
  embedding: number[],
  limit: number,
): Promise<SimilarMessage[]> {
  const memories = await rankEncryptedMemories(userId, embedding, limit, true);
  return memories.map(({ memory, role, similarity }) => ({
    role,
    content: memory.content,
    similarity,
  }));
}

export async function searchMemoriesByEmbedding(
  userId: number,
  queryVector: number[],
  limit = 5,
): Promise<MemoryRow[]> {
  const memories = await rankEncryptedMemories(
    userId,
    queryVector,
    limit,
    false,
  );
  return memories.map(({ memory, similarity }) => ({
    ...memory,
    similarity,
  }));
}
