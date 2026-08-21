import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * promisify() resolves to scrypt's no-options overload, which drops the cost
 * parameters silently — so this wraps the callback form explicitly rather than
 * letting the types quietly pick the wrong signature.
 */
function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Password hashing with scrypt.
 *
 * scrypt is memory-hard and ships in Node's standard library, so this needs no
 * third-party dependency — one less package in the supply chain for the single
 * most security-sensitive path in the app.
 *
 * NODE ONLY. Never import this from middleware: Next.js middleware runs on the
 * Edge runtime, which has no node:crypto. Session verification (which
 * middleware does need) lives in session.ts and uses Web Crypto instead.
 */

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// Cost parameters. N must be a power of two; maxmem has to be raised to match
// or Node rejects the call.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Returns `scrypt$N$r$p$salt$hash`, all hex — self-describing so parameters can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Constant-time verification. Returns false rather than throwing on a
 * malformed hash, so a corrupted record can't crash the login route.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;

    const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
    const N = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    if (salt.length === 0 || expected.length === 0) return false;

    const derived = await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    });

    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Minimum viable password policy. Length is what actually matters; arbitrary character classes mostly produce worse passwords. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 12) return "Password must be at least 12 characters.";
  if (password.length > 200) return "Password must be under 200 characters.";
  return null;
}
