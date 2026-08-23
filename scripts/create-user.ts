/**
 * Creates or updates a dashboard user, and prints the env vars needed for the
 * read-only deployment (where there is no writable users table).
 *
 *   npx tsx scripts/create-user.ts you@example.com 'a long passphrase'
 *
 * The password is taken as an argument for convenience in a private terminal;
 * prefer piping it in or clearing your shell history afterwards.
 */
import { randomUUID, randomBytes } from "node:crypto";
import { hashPassword, validatePasswordStrength } from "@market-outreach/core";
import { createRepositories } from "@market-outreach/db";

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error("Usage: npx tsx scripts/create-user.ts <email> <password>");
    process.exit(1);
  }

  const strengthError = validatePasswordStrength(password);
  if (strengthError) {
    console.error(strengthError);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  try {
    const repos = createRepositories();
    const existing = await repos.users.getByEmail(email);
    await repos.users.upsert({
      id: existing?.id ?? randomUUID(),
      email: email.trim(),
      passwordHash,
      name: existing?.name ?? "",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastLoginAt: existing?.lastLoginAt ?? null,
    });
    console.log(existing ? `Updated password for ${email}.` : `Created user ${email}.`);
  } catch (err) {
    console.log(`Could not write to the database (${(err as Error).message}).`);
    console.log("That's expected against a read-only demo database — use the env vars below instead.\n");
  }

  console.log("\nFor a deployment whose database is read-only (e.g. Vercel), set these:\n");
  console.log(`  SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
  console.log(`  ADMIN_EMAIL=${email.trim().toLowerCase()}`);
  console.log(`  ADMIN_PASSWORD_HASH=${passwordHash}`);
  console.log("\nSESSION_SECRET above is freshly generated — reuse your existing one if you already set it,");
  console.log("since changing it signs everyone out.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
