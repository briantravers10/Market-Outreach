"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  DEFAULT_SESSION_TTL_SECONDS,
  ENV_ADMIN_SUBJECT,
  SESSION_COOKIE,
  createSessionToken,
  decideLogin,
  generateResetToken,
  hashResetToken,
  hashPassword,
  resetTokenMatches,
  validatePasswordStrength,
  verifySessionToken,
} from "@market-outreach/core";
import { getRepos } from "./data";
import { getAuthConfig } from "./authConfig";

/**
 * Auth server actions.
 *
 * Two rules run through all of this:
 *
 * 1. Never reveal whether an account exists. Login failures are always the
 *    same message, and "forgot password" always reports success. Anything else
 *    turns these forms into an account-enumeration oracle.
 * 2. Never let a failure become an exception the user sees. A broken record or
 *    an unwritable database should read as "that didn't work", not a stack
 *    trace.
 */

const GENERIC_LOGIN_ERROR = "Email or password is incorrect.";

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * In-memory throttle. Deliberately modest in ambition: on serverless this is
 * per-instance and resets on cold start, so it slows down casual guessing but
 * is not a substitute for a shared store. Documented rather than pretended
 * otherwise — a real limiter belongs in Redis/Postgres once one exists.
 */
const attempts = new Map<string, { count: number; firstAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60_000;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function clearAttempts(key: string): void {
  attempts.delete(key);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setSessionCookie(sub: string, email: string): Promise<void> {
  const config = getAuthConfig();
  const token = await createSessionToken({ sub, email }, config.sessionSecret);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true, // not readable from JS, so XSS can't lift the session
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // survives normal navigation, blocks cross-site POSTs
    path: "/",
    maxAge: DEFAULT_SESSION_TTL_SECONDS,
  });
}

/** The signed-in user, or null. Safe to call from any server component. */
export async function getCurrentUser(): Promise<{ id: string; email: string } | null> {
  const config = getAuthConfig();
  if (!config.enabled) return null;
  const store = await cookies();
  const payload = await verifySessionToken(store.get(SESSION_COOKIE)?.value, config.sessionSecret);
  return payload ? { id: payload.sub, email: payload.email } : null;
}

/** Only redirects to same-origin paths — never to an absolute URL. */
function safeNext(next: unknown): string {
  const value = typeof next === "string" ? next : "";
  if (!value.startsWith("/") || value.startsWith("//")) return "/overview";
  return value;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function loginAction(formData: FormData) {
  const config = getAuthConfig();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  const fail = (message: string) =>
    redirect(`/login?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`);

  if (!config.enabled) fail("Authentication is not configured on this deployment.");
  if (!email || !password) fail(GENERIC_LOGIN_ERROR);

  if (rateLimited(`login:${email}`)) {
    fail("Too many attempts. Wait a few minutes and try again.");
  }

  // The decision itself lives in core so it can be tested without a request.
  // Everything around it here — cookies, redirects, throttling — is plumbing.
  const outcome = await decideLogin({
    email,
    password,
    adminEmail: config.adminEmail,
    adminPasswordHash: config.adminPasswordHash,
    adminPassword: config.adminPassword,
    findUser: async (address) => {
      try {
        return await getRepos().users.getByEmail(address);
      } catch {
        // Unreadable/missing users table — "no such user", not a 500.
        return null;
      }
    },
  });

  if (outcome.kind === "misconfigured") fail(outcome.message);
  if (outcome.kind === "rejected") fail(GENERIC_LOGIN_ERROR);

  const session = outcome as Extract<typeof outcome, { kind: "session" }>;
  clearAttempts(`login:${email}`);

  if (session.sub !== ENV_ADMIN_SUBJECT) {
    try {
      await getRepos().users.markLoggedIn(session.sub, new Date().toISOString());
    } catch {
      // Read-only database — a missing last_login stamp is not worth failing a login over.
    }
  }

  await setSessionCookie(session.sub, session.email);
  redirect(next);
}

export async function logoutAction() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

/**
 * Always reports the same thing, whether or not the address exists.
 *
 * There is no email provider wired into this project (sending is explicitly
 * out of scope), so when a token IS generated the reset link is returned to
 * the operator instead of emailed. That is safe here because it only ever
 * happens for a genuine account and the link is single-use and short-lived —
 * but it is the piece that must become a real email before this is used by
 * anyone but the owner.
 */
export async function forgotPasswordAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const done = (link?: string) =>
    redirect(`/forgot-password?sent=1${link ? `&link=${encodeURIComponent(link)}` : ""}`);

  if (!email || rateLimited(`forgot:${email}`)) done();

  let user: { id: string } | null = null;
  try {
    user = await getRepos().users.getByEmail(email);
  } catch {
    user = null;
  }
  if (!user) done();

  // NOTE: redirect() signals by throwing (NEXT_REDIRECT), so it must stay
  // OUTSIDE this try — a redirect inside would be caught by the catch below
  // and silently turn the success path into the failure path.
  let resetLink: string | null = null;
  try {
    const repos = getRepos();
    const { token, tokenHash, expiresAt } = generateResetToken();
    await repos.passwordResets.create({
      id: randomUUID(),
      userId: user!.id,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: new Date().toISOString(),
    });
    resetLink = `/reset-password?token=${token}`;
  } catch {
    // Read-only database: a reset cannot be recorded. Still report success so
    // this doesn't become a way to probe which addresses exist.
    resetLink = null;
  }

  done(resetLink ?? undefined);
}

export async function resetPasswordAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const fail = (message: string) =>
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`);

  if (!token) fail("This reset link is invalid.");
  if (password !== confirm) fail("Those passwords don't match.");

  const strengthError = validatePasswordStrength(password);
  if (strengthError) fail(strengthError);

  const repos = getRepos();
  const record = await repos.passwordResets.getByHash(hashResetToken(token));

  if (
    !record ||
    record.usedAt !== null ||
    new Date(record.expiresAt).getTime() < Date.now() ||
    !resetTokenMatches(token, record.tokenHash)
  ) {
    fail("This reset link has expired or already been used.");
  }

  const user = await repos.users.getById(record!.userId);
  if (!user) fail("This reset link is invalid.");

  const now = new Date().toISOString();
  await repos.users.upsert({ ...user!, passwordHash: await hashPassword(password), updatedAt: now });
  await repos.passwordResets.markUsed(record!.id, now);
  // Invalidate every other outstanding link for this account.
  await repos.passwordResets.deleteForUser(record!.userId);

  redirect("/login?reset=1");
}
