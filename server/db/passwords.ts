// Password hashing helpers. Pure functions with no database access.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Hash a password with a random salt before storing it in Postgres.
export function hashPassword(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

// Check whether a password matches the stored hash without leaking timing data.
export function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
