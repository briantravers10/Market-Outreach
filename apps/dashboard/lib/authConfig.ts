/**
 * Authentication configuration, readable from BOTH the Edge runtime
 * (middleware) and Node (server actions) — so it must depend only on
 * environment variables, never on the database.
 *
 * Posture:
 *
 *   SESSION_SECRET set          -> auth is ON. Every route requires a session.
 *   not set, DEMO_READ_ONLY=1   -> public read-only demo of synthetic data.
 *                                  This is the only case that serves anything
 *                                  without a login, and it can only ever show
 *                                  fake data from a read-only snapshot.
 *   not set, not demo           -> FAIL CLOSED. A real deployment holding real
 *                                  prospect data refuses to serve rather than
 *                                  quietly exposing it.
 *
 * The bootstrap admin (ADMIN_EMAIL + ADMIN_PASSWORD_HASH) exists because the
 * deployed database is opened read-only — there is nowhere to write a users
 * row. Env credentials plus a stateless signed cookie mean login works anyway.
 */

export interface AuthConfig {
  enabled: boolean;
  sessionSecret: string;
  adminEmail: string | null;
  adminPasswordHash: string | null;
  demoReadOnly: boolean;
}

export function getAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const sessionSecret = env.SESSION_SECRET?.trim() ?? "";
  return {
    enabled: sessionSecret.length > 0,
    sessionSecret,
    adminEmail: env.ADMIN_EMAIL?.trim().toLowerCase() || null,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH?.trim() || null,
    demoReadOnly: env.DEMO_READ_ONLY === "1",
  };
}

/**
 * True when the app must refuse to serve: no auth configured, and not
 * explicitly marked as the synthetic-data demo.
 */
export function isMisconfigured(config: AuthConfig = getAuthConfig()): boolean {
  return !config.enabled && !config.demoReadOnly;
}

/** Routes reachable without a session. Everything else is protected. */
export const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
