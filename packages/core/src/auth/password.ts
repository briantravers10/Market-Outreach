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

/**
 * Returns `scrypt$N$r$p$salt$hash`, all hex — self-describing, so the cost
 * parameters can be raised later without invalidating existing hashes.
 *
 * The key length is NOT negotiable per-hash: verification requires exactly
 * KEY_LENGTH bytes, because accepting a shorter stored value would accept a
 * prefix of the real hash. Changing KEY_LENGTH is therefore a migration, not a
 * setting.
 */
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

    // The stored hash must be exactly the length we produce.
    //
    // Deriving to `expected.length` instead — which this used to do — is
    // dangerous, because scrypt finishes with a single PBKDF2 pass and its
    // output is therefore prefix-stable: the first 8 bytes of a 64-byte hash
    // are the first 8 bytes of an 8-byte hash of the same password. A stored
    // value shortened to two hex characters would then accept roughly one
    // password in 256. Requiring the full length removes that entirely, and
    // has the side effect of making a truncated hash fail loudly rather than
    // continuing to work right up until the moment it doesn't.
    if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
    // Buffer.from stops at the first non-hex character rather than throwing,
    // so a hash with garbage in the middle can still reach the right length.
    if (!/^[0-9a-fA-F]+$/.test(saltHex) || !/^[0-9a-fA-F]+$/.test(hashHex)) return false;

    const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
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

/**
 * Why a stored hash is unusable, in words — or null if it is well-formed.
 *
 * `verifyPassword` deliberately returns false for a malformed hash so a
 * corrupted record cannot crash the login route. That is right for a *record*,
 * and wrong for a *deployment setting*: a truncated ADMIN_PASSWORD_HASH then
 * looks exactly like a mistyped password, and the operator hunts the wrong
 * problem. This tells the two apart.
 *
 * Never returns any part of the hash — only its shape.
 */
export function hashFormatError(stored: string): string | null {
  const trimmed = stored.trim();
  if (!trimmed) return "it is empty";

  const parts = trimmed.split("$");
  if (parts[0] !== "scrypt") return "it does not begin with \"scrypt$\"";
  if (parts.length !== 6) {
    return `it has ${parts.length - 1} "$" separators, and a valid hash has 5 — it looks truncated or partially pasted`;
  }

  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  for (const [label, raw] of [["N", nRaw], ["r", rRaw], ["p", pRaw]] as const) {
    if (!Number.isFinite(Number(raw)) || Number(raw) <= 0) return `its ${label} cost parameter is not a positive number`;
  }
  if (!/^[0-9a-f]+$/i.test(saltHex)) return "its salt section contains characters that are not hex";
  if (!/^[0-9a-f]+$/i.test(hashHex)) return "its hash section contains characters that are not hex";
  if (saltHex.length !== SALT_BYTES * 2) {
    return `its salt is ${saltHex.length} hex characters, and a valid one is ${SALT_BYTES * 2}`;
  }
  if (hashHex.length !== KEY_LENGTH * 2) {
    return `its hash is ${hashHex.length} hex characters, and a valid one is ${KEY_LENGTH * 2} — this is the signature of a value that got cut off`;
  }
  return null;
}

/** Minimum viable password policy. Length is what actually matters; arbitrary character classes mostly produce worse passwords. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 12) return "Password must be at least 12 characters.";
  if (password.length > 200) return "Password must be under 200 characters.";
  return null;
}
