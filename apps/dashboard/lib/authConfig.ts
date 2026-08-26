/**
 * Authentication configuration, readable from BOTH the Edge runtime
 * (middleware) and Node (server actions) — so it must depend only on
 * environment variables, never on the database.
 *
 * Posture:
 *
 *   SESSION_SECRET set          -> auth is ON. Every route requires a session.
 *   not set, DEMO_READ_ONLY=1,
 *   and no DATABASE_URL         -> public read-only demo of synthetic data.
 *                                  This is the only case that serves anything
 *                                  without a login, and it can only ever show
 *                                  fake data from a read-only snapshot.
 *   anything else               -> FAIL CLOSED. A real deployment holding real
 *                                  prospect data refuses to serve rather than
 *                                  quietly exposing it.
 *
 * DATABASE_URL cancels the demo exemption deliberately. That exemption is only
 * safe because the demo's SQLite snapshot is read-only and synthetic; a
 * Postgres connection is neither. Without this, setting DATABASE_URL on the
 * existing demo deployment — the natural next step when going live — would
 * quietly publish a writable database to anyone with the URL.
 *
 * The bootstrap admin (ADMIN_EMAIL + ADMIN_PASSWORD_HASH, or ADMIN_PASSWORD)
 * exists because the deployed database may be opened read-only — there is then
 * nowhere to write a users row. Env credentials plus a stateless signed cookie
 * mean login works anyway.
 *
 * It is a fallback, not a gate: a failure here falls through to the users
 * table rather than ending the attempt. See loginPolicy.ts for why.
 */

export interface AuthConfig {
  enabled: boolean;
  sessionSecret: string;
  adminEmail: string | null;
  adminPasswordHash: string | null;
  /**
   * Plaintext alternative to the hash, for when pasting a 178-character
   * unbroken string into a hosting dashboard is the thing that keeps going
   * wrong. Second in line behind the hash — see loginPolicy.ts.
   */
  adminPassword: string | null;
  demoReadOnly: boolean;
  /** A real database is attached, so nothing here is a throwaway snapshot. */
  hasDatabase: boolean;
}

export function getAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const sessionSecret = env.SESSION_SECRET?.trim() ?? "";
  return {
    enabled: sessionSecret.length > 0,
    sessionSecret,
    adminEmail: env.ADMIN_EMAIL?.trim().toLowerCase() || null,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH?.trim() || null,
    adminPassword: env.ADMIN_PASSWORD?.trim() || null,
    demoReadOnly: env.DEMO_READ_ONLY === "1",
    hasDatabase: (env.DATABASE_URL?.trim() ?? "").length > 0,
  };
}

/**
 * True when the app must refuse to serve: no auth configured, and not the
 * synthetic-data demo. A demo with DATABASE_URL attached is not a demo.
 */
export function isMisconfigured(config: AuthConfig = getAuthConfig()): boolean {
  if (config.enabled) return false;
  return !config.demoReadOnly || config.hasDatabase;
}

/** Routes reachable without a session. Everything else is protected. */
export const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
