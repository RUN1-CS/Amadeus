// Short-lived in-memory cache in front of session lookups, shared by the HTTP and WebSocket layers.
import { getUserBySession } from "./db.js";
import { maxEntries, ttlMs } from "./config.js";

type CachedUser = NonNullable<Awaited<ReturnType<typeof getUserBySession>>>;

const cache = new Map<string, { user: CachedUser; expiresAt: number }>();

// Resolve a session token to its user, hitting the database at most once per TTL.
export async function getCachedUserBySession(token: string | undefined) {
  if (!token) return undefined;

  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.expiresAt > now) return hit.user;
  cache.delete(token);

  const user = await getUserBySession(token);
  if (!user) return undefined;

  if (cache.size >= maxEntries) {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  cache.set(token, { user, expiresAt: now + ttlMs });
  return user;
}

// Drop cached entries for a user after their profile changes so the next lookup is fresh.
export function invalidateUserCache(userId: number) {
  for (const [token, entry] of cache) {
    if (entry.user.id === userId) cache.delete(token);
  }
}
