import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Password-reset tokens.
 *
 * The raw token goes in the reset link and is never stored. Only its SHA-256
 * hash is persisted, so a leaked database still doesn't let anyone reset an
 * account — the same reason password hashes exist. SHA-256 rather than scrypt
 * is right here: the token is 256 bits of CSPRNG output, so there is no
 * low-entropy secret to slow a guesser down on.
 *
 * NODE ONLY (node:crypto) — used from server actions, never middleware.
 */

export const RESET_TOKEN_TTL_MINUTES = 30;

export interface GeneratedResetToken {
  /** Goes in the emailed link. Never stored. */
  token: string;
  /** Stored instead. */
  tokenHash: string;
  expiresAt: string;
}

export function generateResetToken(ttlMinutes: number = RESET_TOKEN_TTL_MINUTES): GeneratedResetToken {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
  };
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time compare of a presented token against a stored hash. */
export function resetTokenMatches(token: string, storedHash: string): boolean {
  try {
    const a = Buffer.from(hashResetToken(token), "hex");
    const b = Buffer.from(storedHash, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
