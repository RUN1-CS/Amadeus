import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createSession,
  deleteAccount,
  login,
  register,
  updateAccount,
} from "../db.js";
import {
  loginMaxFailures,
  loginWindowMs,
  registerMaxAttempts,
  registerWindowMs,
} from "../config.js";
import { invalidateUserCache } from "../sessions.js";
import { readJson, requireUser, sendJson } from "./shared.js";

const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: IncomingMessage, scope: string) {
  const forwarded =
    process.env.TRUST_PROXY === "true"
      ? request.headers["x-forwarded-for"]
      : undefined;
  const address =
    (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : "") ||
    request.socket.remoteAddress ||
    "unknown";
  return `${scope}:${address}`;
}

function isBlocked(key: string, max: number) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= max;
}

function recordAttempt(key: string, windowMs: number) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    entry.count += 1;
  }
  if (attempts.size > 5_000) {
    for (const [existingKey, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(existingKey);
    }
  }
}

export async function handleAuthRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<boolean> {
  if (request.method === "POST" && path === "/api/auth/register") {
    const key = clientKey(request, "register");
    if (isBlocked(key, registerMaxAttempts)) {
      sendJson(response, 429, {
        error: "Too many sign-up attempts. Try again later.",
      });
      return true;
    }
    recordAttempt(key, registerWindowMs);
    const body = await readJson(request);
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (
      !username.trim() ||
      Array.from(username.trim()).length > 50 ||
      password.length < 8
    ) {
      sendJson(response, 400, {
        error:
          "Use a username of at most 50 characters and a password of at least 8 characters.",
      });
      return true;
    }
    const user = await register(username, password);
    sendJson(response, 201, { user, token: await createSession(user.id) });
    return true;
  }

  if (request.method === "POST" && path === "/api/auth/login") {
    const key = clientKey(request, "login");
    if (isBlocked(key, loginMaxFailures)) {
      sendJson(response, 429, {
        error: "Too many failed logins. Try again later.",
      });
      return true;
    }
    const body = await readJson(request);
    const user = await login(
      String(body.username ?? ""),
      String(body.password ?? ""),
    );
    if (!user) {
      recordAttempt(key, loginWindowMs);
      sendJson(response, 401, { error: "Invalid username or password." });
      return true;
    }
    attempts.delete(key);
    sendJson(response, 200, { user, token: await createSession(user.id) });
    return true;
  }

  if (request.method === "GET" && path === "/api/auth/me") {
    const user = await requireUser(request, response);
    if (user) sendJson(response, 200, { user });
    return true;
  }

  if (request.method === "PATCH" && path === "/api/auth/account") {
    const user = await requireUser(request, response);
    if (!user) return true;
    const body = await readJson(request);
    const username =
      typeof body.username === "string" ? body.username.trim() : "";
    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword =
      typeof body.newPassword === "string" ? body.newPassword : "";
    const aboutMe = typeof body.aboutMe === "string" ? body.aboutMe : "";
    const customBehavior =
      typeof body.customBehavior === "string" ? body.customBehavior : "";
    if (
      !username ||
      Array.from(username).length > 50 ||
      !currentPassword ||
      (newPassword && newPassword.length < 8)
    ) {
      sendJson(response, 400, {
        error:
          "Enter a username of 1 to 50 characters, your current password, and a valid new password.",
      });
      return true;
    }
    const updatedUser = await updateAccount(
      user.id,
      currentPassword,
      username,
      newPassword || undefined,
      aboutMe,
      customBehavior,
    );
    if (!updatedUser) {
      sendJson(response, 401, { error: "Current password is incorrect." });
      return true;
    }
    invalidateUserCache(user.id);
    sendJson(response, 200, { user: updatedUser });
    return true;
  }

  if (request.method === "POST" && path === "/api/auth/delete") {
    const user = await requireUser(request, response);
    if (!user) return true;
    const body = await readJson(request);
    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    if (!currentPassword) {
      sendJson(response, 400, { error: "Enter your current password." });
      return true;
    }
    const deleted = await deleteAccount(user.id, currentPassword);
    if (!deleted) {
      sendJson(response, 401, { error: "Current password is incorrect." });
      return true;
    }
    invalidateUserCache(user.id);
    sendJson(response, 200, { deleted: true });
    return true;
  }

  return false;
}
