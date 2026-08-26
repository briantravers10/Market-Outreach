/**
 * Login policy test suite.
 *
 * Read-only and offline: it builds credentials in memory and asks
 * `decideLogin` what it would do. It touches no database and needs no request,
 * which is the whole reason the decision was pulled out of the server action.
 *
 * The case that matters most here is the one that actually bit us: an
 * ADMIN_PASSWORD_HASH that no longer matches must NOT stop a valid database
 * user from logging in. Everything else is guarding that fix from regressing.
 *
 *   npm run test-auth
 */
import {
  decideLogin,
  hashFormatError,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
  ENV_ADMIN_SUBJECT,
  type LoginUser,
} from "@market-outreach/core";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

const ADMIN_EMAIL = "owner@example.com";
const ADMIN_PASSWORD = "correct-horse-battery-staple";
const DB_EMAIL = "owner@example.com";
const DB_PASSWORD = "a-different-long-passphrase";
const OTHER_EMAIL = "someone.else@example.com";

/** No user at all — the state the live database was actually in. */
const noUsers = async (): Promise<LoginUser | null> => null;

function usersTable(...rows: LoginUser[]) {
  return async (email: string) => rows.find((r) => r.email === email) ?? null;
}

async function main(): Promise<void> {
  const adminHash = await hashPassword(ADMIN_PASSWORD);
  const dbHash = await hashPassword(DB_PASSWORD);
  const dbUser: LoginUser = { id: "user-1", email: DB_EMAIL, passwordHash: dbHash };

  // -------------------------------------------------------------------------
  section("Hash shape detection");
  // -------------------------------------------------------------------------

  check("a freshly generated hash is well-formed", hashFormatError(adminHash) === null);
  check("a valid hash is 178 characters", adminHash.length === 178, `got ${adminHash.length}`);
  check("a valid hash has 5 separators", (adminHash.match(/\$/g) ?? []).length === 5);

  check("an empty value is reported", hashFormatError("") !== null);
  check("a whitespace-only value is reported", hashFormatError("   \n  ") !== null);
  check(
    "a value not starting with scrypt is reported",
    (hashFormatError("bcrypt$16384$8$1$aa$bb") ?? "").includes("scrypt")
  );

  // The exact failure mode from the lockout: a long single-line value pasted
  // on a touch device, cut short.
  const truncated = adminHash.slice(0, 120);
  const truncatedProblem = hashFormatError(truncated);
  check("a truncated hash is reported", truncatedProblem !== null);
  check(
    "the truncated-hash message says it was cut off",
    (truncatedProblem ?? "").includes("cut off"),
    truncatedProblem ?? "(none)"
  );

  // Losing the tail entirely drops a separator instead of shortening the hash.
  const severed = adminHash.split("$").slice(0, 4).join("$");
  check(
    "a severed hash reports the separator count",
    (hashFormatError(severed) ?? "").includes("separators"),
    hashFormatError(severed) ?? "(none)"
  );

  // A line-wrapped paste keeps the length but poisons the hex.
  const wrapped = `${adminHash.slice(0, 100)}\n${adminHash.slice(100)}`;
  check("a line-wrapped hash is reported", hashFormatError(wrapped) !== null);

  check(
    "a non-hex salt is reported",
    (hashFormatError("scrypt$16384$8$1$zzzz$aabb") ?? "").includes("hex")
  );
  check(
    "a non-numeric cost parameter is reported",
    (hashFormatError(`scrypt$notanumber$8$1$${"a".repeat(32)}$${"b".repeat(128)}`) ?? "").includes("cost")
  );
  check(
    "surrounding whitespace alone is not an error",
    hashFormatError(`  ${adminHash}  `) === null
  );
  check("the message never contains the hash itself", !(hashFormatError(truncated) ?? "").includes(truncated.slice(20, 60)));

  // -------------------------------------------------------------------------
  section("Environment-variable admin");
  // -------------------------------------------------------------------------

  const envOnly = {
    adminEmail: ADMIN_EMAIL,
    adminPasswordHash: adminHash,
    findUser: noUsers,
  };

  const good = await decideLogin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, ...envOnly });
  check("the env admin logs in with the right password", good.kind === "session");
  check(
    "the env admin session uses the env-admin subject",
    good.kind === "session" && good.sub === ENV_ADMIN_SUBJECT
  );

  const wrongPw = await decideLogin({ email: ADMIN_EMAIL, password: "wrong", ...envOnly });
  check("the env admin is rejected with the wrong password", wrongPw.kind === "rejected");

  const wrongEmail = await decideLogin({ email: OTHER_EMAIL, password: ADMIN_PASSWORD, ...envOnly });
  check("a different email is rejected", wrongEmail.kind === "rejected");

  check(
    "an empty password is rejected without consulting anything",
    (await decideLogin({ email: ADMIN_EMAIL, password: "", ...envOnly })).kind === "rejected"
  );
  check(
    "an empty email is rejected",
    (await decideLogin({ email: "", password: ADMIN_PASSWORD, ...envOnly })).kind === "rejected"
  );

  // -------------------------------------------------------------------------
  section("Misconfiguration is not a credential error");
  // -------------------------------------------------------------------------

  const broken = await decideLogin({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    adminEmail: ADMIN_EMAIL,
    adminPasswordHash: truncated,
    findUser: noUsers,
  });
  check("a truncated admin hash reports misconfiguration", broken.kind === "misconfigured");
  check(
    "the misconfiguration message names the variable",
    broken.kind === "misconfigured" && broken.message.includes("ADMIN_PASSWORD_HASH")
  );
  check(
    "the misconfiguration message tells you to redeploy",
    broken.kind === "misconfigured" && broken.message.includes("redeploy")
  );
  check(
    "the misconfiguration message never contains the hash",
    broken.kind === "misconfigured" && !broken.message.includes(truncated.slice(20, 60))
  );

  // Reported regardless of who is trying, so it cannot be used to find out
  // which address is the admin.
  const brokenStranger = await decideLogin({
    email: OTHER_EMAIL,
    password: "anything",
    adminEmail: ADMIN_EMAIL,
    adminPasswordHash: truncated,
    findUser: noUsers,
  });
  check(
    "misconfiguration is reported to any address, so it leaks no account",
    brokenStranger.kind === "misconfigured"
  );

  // -------------------------------------------------------------------------
  section("ADMIN_PASSWORD — the paste-proof alternative");
  // -------------------------------------------------------------------------

  const plainOnly = {
    adminEmail: ADMIN_EMAIL,
    adminPasswordHash: null,
    adminPassword: ADMIN_PASSWORD,
    findUser: noUsers,
  };

  const plainGood = await decideLogin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, ...plainOnly });
  check("a plaintext admin password logs in", plainGood.kind === "session");
  check(
    "the plaintext path uses the env-admin subject",
    plainGood.kind === "session" && plainGood.sub === ENV_ADMIN_SUBJECT
  );
  check(
    "the wrong password is still rejected",
    (await decideLogin({ email: ADMIN_EMAIL, password: "wrong", ...plainOnly })).kind === "rejected"
  );
  check(
    "a different email cannot use the plaintext password",
    (await decideLogin({ email: OTHER_EMAIL, password: ADMIN_PASSWORD, ...plainOnly })).kind === "rejected"
  );
  check(
    "a password that is a prefix of the real one is rejected",
    (await decideLogin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD.slice(0, -1), ...plainOnly })).kind ===
      "rejected"
  );
  check(
    "surrounding whitespace in the env var is tolerated",
    (
      await decideLogin({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        ...plainOnly,
        adminPassword: `  ${ADMIN_PASSWORD}  `,
      })
    ).kind === "session"
  );
  check(
    "an empty ADMIN_PASSWORD does not admit an empty password",
    (
      await decideLogin({
        email: ADMIN_EMAIL,
        password: "",
        ...plainOnly,
        adminPassword: "",
      })
    ).kind === "rejected"
  );
  check(
    "a whitespace-only ADMIN_PASSWORD is treated as unset",
    (
      await decideLogin({
        email: ADMIN_EMAIL,
        password: "   ",
        ...plainOnly,
        adminPassword: "   ",
      })
    ).kind === "rejected"
  );

  // With both set, the hash wins — but a mangled hash must not veto a correct
  // plaintext password, which is the whole point of having the fallback.
  const bothSet = {
    email: ADMIN_EMAIL,
    adminEmail: ADMIN_EMAIL,
    adminPasswordHash: truncated,
    adminPassword: ADMIN_PASSWORD,
    findUser: noUsers,
  };
  const rescued = await decideLogin({ ...bothSet, password: ADMIN_PASSWORD });
  check("a broken hash no longer blocks login when ADMIN_PASSWORD is set", rescued.kind === "session");
  check(
    "a broken hash with no plaintext fallback still reports misconfiguration",
    (await decideLogin({ ...bothSet, password: ADMIN_PASSWORD, adminPassword: null })).kind === "misconfigured"
  );
  check(
    "with both set, the hash's password still works",
    (
      await decideLogin({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        adminEmail: ADMIN_EMAIL,
        adminPasswordHash: adminHash,
        adminPassword: "some-other-thing",
        findUser: noUsers,
      })
    ).kind === "session"
  );

  // -------------------------------------------------------------------------
  section("Fallthrough — the lockout fix");
  // -------------------------------------------------------------------------

  // THE regression test. Same email as the env admin, env hash present and
  // valid but for a different password, and a real user row that does match.
  const staleAdminHash = await hashPassword("what-the-env-var-was-set-to");
  const fellThrough = await decideLogin({
    email: DB_EMAIL,
    password: DB_PASSWORD,
    adminEmail: ADMIN_EMAIL,
    adminPasswordHash: staleAdminHash,
    findUser: usersTable(dbUser),
  });
  check(
    "a stale ADMIN_PASSWORD_HASH does not block a valid database user",
    fellThrough.kind === "session",
    `got ${fellThrough.kind}`
  );
  check(
    "the fallthrough session belongs to the database user, not env-admin",
    fellThrough.kind === "session" && fellThrough.sub === dbUser.id
  );

  // The env var still wins when it is correct, so nothing regressed the other way.
  const envStillWins = await decideLogin({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    adminEmail: ADMIN_EMAIL,
    adminPasswordHash: adminHash,
    findUser: usersTable(dbUser),
  });
  check(
    "a correct env hash still logs in as env-admin",
    envStillWins.kind === "session" && envStillWins.sub === ENV_ADMIN_SUBJECT
  );

  // Falling through must not become a way in with no credentials at all.
  const bothWrong = await decideLogin({
    email: DB_EMAIL,
    password: "neither-of-the-two-passwords",
    adminEmail: ADMIN_EMAIL,
    adminPasswordHash: staleAdminHash,
    findUser: usersTable(dbUser),
  });
  check("failing both credentials is still a rejection", bothWrong.kind === "rejected");

  check(
    "no admin configured at all still allows a database user",
    (
      await decideLogin({
        email: DB_EMAIL,
        password: DB_PASSWORD,
        adminEmail: null,
        adminPasswordHash: null,
        findUser: usersTable(dbUser),
      })
    ).kind === "session"
  );

  check(
    "an unreadable users table is a rejection, not a crash",
    (
      await decideLogin({
        email: DB_EMAIL,
        password: DB_PASSWORD,
        adminEmail: null,
        adminPasswordHash: null,
        findUser: async () => null,
      })
    ).kind === "rejected"
  );

  // -------------------------------------------------------------------------
  section("Database users");
  // -------------------------------------------------------------------------

  const dbOnly = { adminEmail: null, adminPasswordHash: null, findUser: usersTable(dbUser) };
  check(
    "the right password logs the user in",
    (await decideLogin({ email: DB_EMAIL, password: DB_PASSWORD, ...dbOnly })).kind === "session"
  );
  check(
    "the wrong password is rejected",
    (await decideLogin({ email: DB_EMAIL, password: "nope", ...dbOnly })).kind === "rejected"
  );
  check(
    "an unknown address is rejected",
    (await decideLogin({ email: OTHER_EMAIL, password: DB_PASSWORD, ...dbOnly })).kind === "rejected"
  );

  const sessionForUser = await decideLogin({ email: DB_EMAIL, password: DB_PASSWORD, ...dbOnly });
  check(
    "the session carries the stored email, not the typed one",
    sessionForUser.kind === "session" && sessionForUser.email === dbUser.email
  );

  // A corrupted row must behave like a wrong password, never an exception.
  check(
    "a corrupted stored hash is a rejection",
    (
      await decideLogin({
        email: DB_EMAIL,
        password: DB_PASSWORD,
        ...dbOnly,
        findUser: usersTable({ ...dbUser, passwordHash: "garbage" }),
      })
    ).kind === "rejected"
  );

  // -------------------------------------------------------------------------
  section("Hashing round trip");
  // -------------------------------------------------------------------------

  check("a password verifies against its own hash", await verifyPassword(ADMIN_PASSWORD, adminHash));
  check("a different password does not verify", !(await verifyPassword("something else", adminHash)));
  check("hashing twice gives different hashes (salted)", (await hashPassword(ADMIN_PASSWORD)) !== adminHash);
  check(
    "both salted hashes still verify",
    await verifyPassword(ADMIN_PASSWORD, await hashPassword(ADMIN_PASSWORD))
  );
  check("a truncated hash never verifies", !(await verifyPassword(ADMIN_PASSWORD, truncated)));
  check("verifying against an empty hash is false, not a throw", !(await verifyPassword(ADMIN_PASSWORD, "")));

  // scrypt ends in a single PBKDF2 pass, so its output is prefix-stable: a
  // shortened hash is a valid hash of the same password at a shorter length.
  // Accepting one would mean a 2-hex-character hash lets roughly one password
  // in 256 straight through, so every prefix must be refused outright.
  const [prefix, , , , salt] = adminHash.split("$");
  const hashHex = adminHash.split("$")[5];
  for (const bytes of [1, 2, 8, 32, 63]) {
    const shortened = `${prefix}$16384$8$1$${salt}$${hashHex.slice(0, bytes * 2)}`;
    check(
      `a ${bytes}-byte prefix of the hash does not verify`,
      !(await verifyPassword(ADMIN_PASSWORD, shortened))
    );
  }
  check(
    "an over-long hash does not verify",
    !(await verifyPassword(ADMIN_PASSWORD, `${adminHash}aabb`))
  );
  check(
    "hex garbage padded to the right length does not verify",
    !(await verifyPassword(ADMIN_PASSWORD, `${prefix}$16384$8$1$${salt}$${"zz".repeat(64)}`))
  );

  // Unicode normalisation: the same passphrase typed on two keyboards must match.
  const accented = "café-passphrase-long-enough";
  const accentedHash = await hashPassword(accented.normalize("NFD"));
  check("NFC and NFD forms of a password match", await verifyPassword(accented.normalize("NFC"), accentedHash));

  check("a short password is rejected by the strength check", validatePasswordStrength("short") !== null);
  check("a long passphrase passes the strength check", validatePasswordStrength(DB_PASSWORD) === null);

  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(40)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\nFailures:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
