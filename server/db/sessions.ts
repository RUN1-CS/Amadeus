// Login sessions: opaque bearer tokens stored as SHA-256 hashes.
import { createHash, randomBytes } from "node:crypto";
import { decryptUserValue } from "../data-encryption.js";
import type { SessionRow } from "../types.js";
import { pool, requireUserDataKey } from "./pool.js";
import { publicUser } from "./users.js";

// Create a login token that can be used to authorize future requests.
export async function createSession(userId: number) {
  const token = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO sessions (user_id, session_token, expires_at) VALUES ($1, $2, $3)",
    [
      userId,
      createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    ],
  );
  return token;
}

// Resolve the active user from a bearer token if the session is still valid.
export async function getUserBySession(token: string | undefined) {
  if (!token) return null;
  const result = await pool.query<SessionRow>(
    `SELECT users.id, users.username, users.about_me, users.custom_behavior,
       EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id) AS is_admin,
       EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id AND is_owner) AS is_owner
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.session_token = $1 AND sessions.expires_at > CURRENT_TIMESTAMP`,
    [createHash("sha256").update(token).digest("hex")],
  );
  const user = result.rows[0];
  if (!user) return null;
  const key = await requireUserDataKey(user.id);
  return publicUser({
    ...user,
    username: decryptUserValue(user.username, key),
    about_me: decryptUserValue(user.about_me ?? "", key),
    custom_behavior: decryptUserValue(user.custom_behavior ?? "", key),
  });
}
