import { timingSafeEqual } from "node:crypto";
import { hashFormatError, verifyPassword } from "./password";

/**
 * Who is allowed in, decided as a pure function.
 *
 * This lives apart from the server action on purpose. The action's job is
 * infrastructure — cookies, redirects, rate limiting — and none of that can be
 * exercised in a test without a request. The *decision* is the part that has to
 * be right, so it is separated out where it can be proven.
 *
 * The rule this encodes, learned the hard way: there is always a second way in.
 * An environment variable and a database row are two independent credentials,
 * and failing the first must never stop the second from being tried.
 */

export interface LoginUser {
  id: string;
  email: string;
  passwordHash: string;
}

export type LoginOutcome =
  /** The deployment itself is broken. Safe to say out loud — it names no account. */
  | { kind: "misconfigured"; message: string }
  /** Wrong credentials, or no such account. Always the same message either way. */
  | { kind: "rejected" }
  /** Let them in, as this subject. */
  | { kind: "session"; sub: string; email: string };

export interface LoginPolicyInput {
  /** Already trimmed and lowercased by the caller. */
  email: string;
  password: string;
  adminEmail: string | null;
  adminPasswordHash: string | null;
  /**
   * The admin password in plain text, as an alternative to the hash.
   *
   * Weaker than ADMIN_PASSWORD_HASH and deliberately second in line, but it
   * exists because the hash is a 178-character unbroken string and the person
   * who has to paste it into a hosting dashboard is often doing it on a phone
   * or tablet. A hash pasted slightly wrong is indistinguishable from a wrong
   * password, and that is exactly how this app locked its owner out.
   *
   * The threat it gives up: an environment variable that leaks reveals a
   * reusable password rather than a hash. The threat it removes: being unable
   * to get in at all. Prefer the hash where you can set it reliably.
   */
  adminPassword?: string | null;
  /**
   * Finds a database user, or null. Must swallow its own errors: an
   * unreadable users table is "no such user", not a crash on the login route.
   */
  findUser: (email: string) => Promise<LoginUser | null>;
}

/** Constant-time string comparison that does not leak length through early exit. */
function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, so compare lengths separately
  // and still run the comparison to keep the work constant-ish.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** The subject recorded in the session cookie for the environment-variable admin. */
export const ENV_ADMIN_SUBJECT = "env-admin";

export async function decideLogin(input: LoginPolicyInput): Promise<LoginOutcome> {
  const { email, password, adminEmail, adminPasswordHash } = input;
  const adminPassword = input.adminPassword?.trim() || null;

  if (!email || !password) return { kind: "rejected" };

  // Checked before the email is looked at, so this cannot be used to discover
  // which address is the admin — it is a statement about the deployment, not
  // about any account.
  //
  // Only a fault when there is no plaintext fallback configured: with
  // ADMIN_PASSWORD set, a mangled hash is survivable rather than fatal, and
  // shouting about it would block a login that is about to succeed.
  if (adminPasswordHash && !adminPassword) {
    const problem = hashFormatError(adminPasswordHash);
    if (problem) {
      return {
        kind: "misconfigured",
        message:
          `ADMIN_PASSWORD_HASH on this deployment is not a usable password hash — ${problem}. ` +
          `Re-paste it as one unbroken line and redeploy, or set ADMIN_PASSWORD instead.`,
      };
    }
  }

  if (adminEmail && email === adminEmail) {
    // The hash is authoritative when it is present and well-formed.
    if (adminPasswordHash && (await verifyPassword(password, adminPasswordHash))) {
      return { kind: "session", sub: ENV_ADMIN_SUBJECT, email };
    }
    if (adminPassword && secretEquals(password, adminPassword)) {
      return { kind: "session", sub: ENV_ADMIN_SUBJECT, email };
    }
    // Deliberately falls through. Stopping here is what turned one mistyped
    // environment variable into a total lockout of a healthy database.
  }

  const user = await input.findUser(email);

  if (!user) {
    // Nothing matched, and the environment-variable admin is not merely wrong
    // but absent. That combination means NO password could ever work here, and
    // "email or password is incorrect" is then an actively misleading thing to
    // say — it sends the operator hunting for a typo in a credential that does
    // not exist. Name the missing variables instead.
    //
    // On enumeration: this branch can only fire on a deployment that is
    // already unusable, and the message describes configuration rather than
    // the submitted address. A correctly configured deployment never reaches
    // it, so normal operation leaks nothing.
    const missing: string[] = [];
    if (!adminEmail) missing.push("ADMIN_EMAIL");
    if (!adminPasswordHash && !adminPassword) missing.push("ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH)");

    if (missing.length > 0) {
      return {
        kind: "misconfigured",
        message:
          `No login is possible with this deployment's current configuration: ` +
          `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set. ` +
          `Set ${missing.length > 1 ? "them" : "it"} for the Production environment — a variable saved only to ` +
          `Preview or Development is invisible here — then redeploy, because Vercel reads these at build time.`,
      };
    }
    return { kind: "rejected" };
  }
  if (!(await verifyPassword(password, user.passwordHash))) return { kind: "rejected" };

  return { kind: "session", sub: user.id, email: user.email };
}
