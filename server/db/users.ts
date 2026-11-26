// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// User accounts: registration, login, profile updates, and deletion.
import {
  createUserDataKey,
  decryptUserValue,
  encryptUserValue,
  getUserDataKey,
  usernameLookup,
} from "../data-encryption.js";
import type { PublicUser, UserRow } from "../types.js";
import { pool, requireUserDataKey } from "./pool.js";
import { hashPassword, verifyPassword } from "./passwords.js";

// Strip sensitive fields down to the public user shape returned to the client.
export function publicUser(
  user: Pick<UserRow, "id" | "username"> & Partial<UserRow>,
): PublicUser {
  return {
    id: Number(user.id),
    username: user.username,
    aboutMe: user.about_me ?? "",
    customBehavior: user.custom_behavior ?? "",
    isAdmin: user.is_admin ?? false,
    isOwner: user.is_owner ?? false,
  };
}

// Normalize user names so sign-in and account updates behave consistently.
function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

// Create a new user account and return the public profile.
export async function register(username: string, password: string) {
  const client = await pool.connect();
  const normalizedUsername = normalizeUsername(username);
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('amadeus_user_roles'))",
    );
    const result = await client.query<{ id: number }>(
      `INSERT INTO users (username, password_hash)
       VALUES ('pending', 'pending') RETURNING id`,
    );
    const userId = Number(result.rows[0]!.id);
    const key = await createUserDataKey(
      client,
      Number(userId),
      normalizedUsername,
    );
    const passwordHash = hashPassword(password);
    const encryptedUsername = encryptUserValue(normalizedUsername, key);
    const encryptedPassword = encryptUserValue(passwordHash, key);
    await client.query(
      `UPDATE users
       SET username = $2, password_hash = $3, about_me = $4,
           custom_behavior = $5
       WHERE id = $1`,
      [
        userId,
        encryptedUsername,
        encryptedPassword,
        encryptUserValue("", key),
        encryptUserValue("", key),
      ],
    );
    const owner = await client.query("SELECT 1 FROM user_admins WHERE is_owner");
    const isOwner = owner.rowCount === 0;
    if (isOwner) {
      await client.query(
        "INSERT INTO user_admins (user_id, is_owner) VALUES ($1, TRUE)",
        [userId],
      );
    }
    await client.query("COMMIT");
    return {
      id: userId,
      username: normalizedUsername,
      aboutMe: "",
      customBehavior: "",
      isAdmin: isOwner,
      isOwner,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Look up a user by name and validate the supplied password.
export async function login(username: string, password: string) {
  const result = await pool.query<UserRow>(
    `SELECT users.id, users.username, users.password_hash, users.about_me,
       users.custom_behavior,
       EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id) AS is_admin,
       EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id AND is_owner) AS is_owner
     FROM users
     JOIN user_data_keys ON user_data_keys.user_id = users.id
     WHERE user_data_keys.username_lookup = $1`,
    [usernameLookup(normalizeUsername(username))],
  );
  const user = result.rows[0];
  if (!user) return null;
  const key = await requireUserDataKey(user.id);
  const passwordHash = decryptUserValue(user.password_hash, key);
  if (!verifyPassword(password, passwordHash)) return null;
  return publicUser({
    ...user,
    username: decryptUserValue(user.username, key),
    about_me: decryptUserValue(user.about_me ?? "", key),
    custom_behavior: decryptUserValue(user.custom_behavior ?? "", key),
  });
}

// Update profile fields and optionally replace the password after verifying the current one.
export async function updateAccount(
  userId: number,
  currentPassword: string,
  username: string,
  newPassword?: string,
  aboutMe = "",
  customBehavior = "",
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<UserRow>(
      `SELECT id, username, password_hash, about_me,
       custom_behavior,
       EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id) AS is_admin,
       EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id AND is_owner) AS is_owner
     FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const user = result.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return null;
    }
    const key = await getUserDataKey(client, userId);
    if (!key) throw new Error(`Encryption key unavailable for user ${userId}.`);
    const passwordHash = decryptUserValue(user.password_hash, key);
    if (!verifyPassword(currentPassword, passwordHash)) {
      await client.query("ROLLBACK");
      return null;
    }

    const normalizedUsername = normalizeUsername(username);
    await client.query(
      "UPDATE user_data_keys SET username_lookup = $1 WHERE user_id = $2",
      [usernameLookup(normalizedUsername), userId],
    );
    const about = aboutMe.trim();
    const behavior = customBehavior.trim();
    await client.query(
      `UPDATE users
       SET username = $1, password_hash = $2, about_me = $3,
           custom_behavior = $4
       WHERE id = $5`,
      [
        encryptUserValue(normalizedUsername, key),
        encryptUserValue(
          newPassword ? hashPassword(newPassword) : passwordHash,
          key,
        ),
        encryptUserValue(about, key),
        encryptUserValue(behavior, key),
        userId,
      ],
    );
    await client.query("COMMIT");
    return publicUser({
      ...user,
      username: normalizedUsername,
      about_me: about,
      custom_behavior: behavior,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteAccount(
  userId: number,
  currentPassword: string,
): Promise<"deleted" | "invalid_password" | "owner_protected"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('amadeus_user_roles'))",
    );
    const result = await client.query<{
      password_hash: string;
      is_owner: boolean;
    }>(
      `SELECT password_hash,
         EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id AND is_owner) AS is_owner
       FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const user = result.rows[0];
    if (!user || !user.password_hash) {
      await client.query("ROLLBACK");
      return "invalid_password";
    }
    const key = await getUserDataKey(client, userId);
    if (
      !key ||
      !verifyPassword(
        currentPassword,
        decryptUserValue(user.password_hash, key),
      )
    ) {
      await client.query("ROLLBACK");
      return "invalid_password";
    }
    if (user.is_owner) {
      await client.query("ROLLBACK");
      return "owner_protected";
    }

    await client.query("DELETE FROM user_data_keys WHERE user_id = $1", [
      userId,
    ]);
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.query("COMMIT");
    return "deleted";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
