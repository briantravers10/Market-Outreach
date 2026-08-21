/**
 * Stateless signed session tokens.
 *
 * Two constraints drove this design:
 *
 * 1. Next.js middleware runs on the Edge runtime, which has no `node:crypto`.
 *    So this file uses Web Crypto (`crypto.subtle`), which exists in both Edge
 *    and Node 18+, and every function here is async as a result.
 *
 * 2. The deployed demo opens its database READ-ONLY. A server-side session
 *    table would therefore be unwritable in production. Signing the session
 *    into the cookie itself means logging in needs no database write at all.
 *
 * The tradeoff of stateless sessions is that they can't be revoked
 * individually before they expire. Rotating SESSION_SECRET invalidates all of
 * them at once, which is the right lever for this size of system; per-session
 * revocation is a reason to move to a session table once there's a writable
 * database.
 */

export interface SessionPayload {
  /** User id, or "env-admin" for the bootstrap admin. */
  sub: string;
  email: string;
  /** Expiry, epoch seconds. */
  exp: number;
}

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Derived from the API rather than naming `CryptoKey` directly, so this module
 * compiles under any tsconfig `lib` setting — it's imported by packages that
 * don't include the DOM lib.
 */
type SubtleKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

async function importKey(secret: string): Promise<SubtleKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** Length-checked, constant-time comparison. */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export const SESSION_COOKIE = "mo_session";
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12;

export async function createSessionToken(
  payload: Omit<SessionPayload, "exp">,
  secret: string,
  ttlSeconds: number = DEFAULT_SESSION_TTL_SECONDS
): Promise<string> {
  const full: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = base64UrlEncode(encoder.encode(JSON.stringify(full)));
  const key = await importKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${base64UrlEncode(signature)}`;
}

/**
 * Verifies signature *before* trusting any field, and returns null on anything
 * unexpected rather than throwing — a malformed cookie is a logged-out user,
 * not a server error.
 */
export async function verifySessionToken(token: string | undefined | null, secret: string): Promise<SessionPayload | null> {
  if (!token || !secret) return null;

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  const body = token.slice(0, dot);
  const signaturePart = token.slice(dot + 1);

  try {
    const key = await importKey(secret);
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
    const provided = base64UrlDecode(signaturePart);
    if (!timingSafeEqualBytes(expected, provided)) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SessionPayload;
    if (typeof payload.exp !== "number" || typeof payload.sub !== "string" || typeof payload.email !== "string") {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}
