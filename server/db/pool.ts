// Shared Postgres pool and per-user encryption key lookup used by every db module.
import { Pool } from "pg";
import { getUserDataKey } from "../data-encryption.js";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function requireUserDataKey(userId: number) {
  const key = await getUserDataKey(pool, userId);
  if (!key) throw new Error(`Encryption key unavailable for user ${userId}.`);
  return key;
}
