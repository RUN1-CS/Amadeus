import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import type { Pool, PoolClient, QueryResult } from "pg";
import { dataEncryptionKey } from "./config.js";

type Queryable = Pick<Pool | PoolClient, "query">;

type EncryptedEnvelope = {
  iv: string;
  tag: string;
  ciphertext: string;
};

function getMasterKey() {
  const key = Buffer.from(dataEncryptionKey, "base64");
  if (
    key.length !== 32 ||
    key.toString("base64").replace(/=+$/, "") !== dataEncryptionKey.replace(/=+$/, "")
  ) {
    throw new Error(
      "DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
    );
  }
  return key;
}

function encryptWithKey(value: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const envelope: EncryptedEnvelope = {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return `enc:v1:${Buffer.from(JSON.stringify(envelope)).toString("base64")}`;
}

function decryptWithKey(value: string, key: Buffer) {
  const encoded = value.slice("enc:v1:".length);
  const envelope = JSON.parse(
    Buffer.from(encoded, "base64").toString("utf8"),
  ) as EncryptedEnvelope;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncryptedValue(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("enc:v1:");
}

export function validateDataEncryptionKey() {
  getMasterKey();
}

export function encryptUserValue(value: string, key: Buffer) {
  return encryptWithKey(value, key);
}

export function decryptUserValue(value: string, key: Buffer) {
  if (!isEncryptedValue(value)) {
    throw new Error("Expected encrypted user data.");
  }
  return decryptWithKey(value, key);
}

export function usernameLookup(username: string) {
  const lookupKey = createHmac("sha256", getMasterKey())
    .update("amadeus:username-index:v1")
    .digest();
  return createHmac("sha256", lookupKey)
    .update(username.trim().toLowerCase())
    .digest("hex");
}

export async function createUserDataKey(
  queryable: Queryable,
  userId: number,
  username: string,
  dataKey = randomBytes(32),
) {
  const wrappedKey = encryptWithKey(dataKey.toString("base64"), getMasterKey());
  await queryable.query(
    `INSERT INTO user_data_keys (user_id, wrapped_key, username_lookup)
     VALUES ($1, $2, $3)`,
    [userId, wrappedKey, usernameLookup(username)],
  );
  return dataKey;
}

export async function getUserDataKey(
  queryable: Queryable,
  userId: number,
): Promise<Buffer | null> {
  const result: QueryResult<{ wrapped_key: string }> = await queryable.query(
    "SELECT wrapped_key FROM user_data_keys WHERE user_id = $1",
    [userId],
  );
  const wrappedKey = result.rows[0]?.wrapped_key;
  if (!wrappedKey) return null;
  const key = Buffer.from(decryptWithKey(wrappedKey, getMasterKey()), "base64");
  if (key.length !== 32) throw new Error("Stored user data key is invalid.");
  return key;
}

export function encryptJsonValue(value: unknown, key: Buffer) {
  return encryptUserValue(JSON.stringify(value), key);
}

export function decryptJsonValue<T>(value: string, key: Buffer): T {
  return JSON.parse(decryptUserValue(value, key)) as T;
}

export async function encryptLegacyUserData(pool: Pool) {
  validateDataEncryptionKey();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('amadeus_user_data_encryption'))",
    );

    const migration = await client.query(
      "SELECT 1 FROM encryption_migrations WHERE version = 'user-data-v1'",
    );
    if (migration.rowCount) {
      const activeKeys = await client.query<{ user_id: number }>(
        "SELECT user_id FROM user_data_keys",
      );
      for (const row of activeKeys.rows) {
        await getUserDataKey(client, row.user_id);
      }
      await client.query("COMMIT");
      return;
    }

    const users = await client.query<{
      id: string;
      username: string;
      password_hash: string;
      about_me: string;
      custom_behavior: string;
    }>(
      `SELECT id, username, password_hash, about_me,
              custom_behavior
       FROM users ORDER BY id FOR UPDATE`,
    );
    const userKeys = new Map<string, Buffer>();
    for (const user of users.rows) {
      if (await getUserDataKey(client, Number(user.id))) {
        throw new Error(
          `User ${user.id} has an encryption key but no migration record.`,
        );
      }
      const key = await createUserDataKey(
        client,
        Number(user.id),
        user.username,
      );

      await client.query(
        `UPDATE users
         SET username = $2, password_hash = $3, about_me = $4,
             custom_behavior = $5
         WHERE id = $1`,
        [
          user.id,
          encryptUserValue(user.username, key),
          encryptUserValue(user.password_hash, key),
          encryptUserValue(user.about_me, key),
          encryptUserValue(user.custom_behavior, key),
        ],
      );
      userKeys.set(user.id, key);
    }

    const batchSize = 250;
    let afterId = "0";
    while (true) {
      const chats = await client.query<{
        id: string;
        user_id: string;
        title: string;
      }>(
        `SELECT id, user_id, title FROM chats
         WHERE id > $1::bigint ORDER BY id LIMIT $2`,
        [afterId, batchSize],
      );
      if (!chats.rows.length) break;
      afterId = chats.rows.at(-1)!.id;
      for (const chat of chats.rows) {
        const key = userKeys.get(chat.user_id);
        if (key) {
          await client.query("UPDATE chats SET title = $2 WHERE id = $1", [
            chat.id,
            encryptUserValue(chat.title, key),
          ]);
        }
      }
    }

    afterId = "0";
    while (true) {
      const messages = await client.query<{
        id: string;
        user_id: string;
        content: string;
        attachments: unknown;
      }>(
        `SELECT id, user_id, content, attachments FROM messages
         WHERE id > $1::bigint ORDER BY id LIMIT $2`,
        [afterId, batchSize],
      );
      if (!messages.rows.length) break;
      afterId = messages.rows.at(-1)!.id;
      for (const message of messages.rows) {
        const key = userKeys.get(message.user_id);
        if (!key) continue;
        const content = encryptUserValue(message.content, key);
        const attachments = encryptUserValue(
          JSON.stringify(message.attachments),
          key,
        );
        await client.query(
          `UPDATE messages SET content = $2, attachments = $3::jsonb
           WHERE id = $1`,
          [message.id, content, JSON.stringify(attachments)],
        );
      }
    }

    afterId = "0";
    while (true) {
      const memories = await client.query<{
        id: string;
        user_id: string;
        content: string;
        source: string;
        metadata: unknown;
        embedding: string | null;
      }>(
        `SELECT id, user_id, content, source, metadata, embedding::text
         FROM memories WHERE id > $1::bigint ORDER BY id LIMIT $2`,
        [afterId, batchSize],
      );
      if (!memories.rows.length) break;
      afterId = memories.rows.at(-1)!.id;
      for (const memory of memories.rows) {
        const key = userKeys.get(memory.user_id);
        if (!key) continue;
        const content = encryptUserValue(memory.content, key);
        const source = encryptUserValue(memory.source, key);
        const metadata = encryptUserValue(JSON.stringify(memory.metadata), key);
        const embedding = memory.embedding
          ? encryptUserValue(memory.embedding, key)
          : null;
        await client.query(
          `UPDATE memories
           SET content = $2, source = $3, metadata = $4::jsonb,
               embedding_ciphertext = $5, embedding = NULL
           WHERE id = $1`,
          [memory.id, content, source, JSON.stringify(metadata), embedding],
        );
      }
    }

    const sessions = await client.query<{
      id: number;
      session_token: string;
    }>("SELECT id, session_token FROM sessions");
    for (const session of sessions.rows) {
      await client.query("UPDATE sessions SET session_token = $2 WHERE id = $1", [
        session.id,
        createHash("sha256").update(session.session_token).digest("hex"),
      ]);
    }

    await client.query(
      "INSERT INTO encryption_migrations (version) VALUES ('user-data-v1')",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function removeUsersWithoutDataKeys(pool: Pool) {
  await pool.query(
    `DELETE FROM users
     WHERE NOT EXISTS (
       SELECT 1 FROM user_data_keys WHERE user_data_keys.user_id = users.id
     )`,
  );
}
