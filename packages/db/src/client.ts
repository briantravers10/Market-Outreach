import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { defaultDbPath, findRepoRoot, isDemoReadOnly } from "./paths";
import { DEMO_DB_BASE64 } from "./demoDbData";

let sharedDb: Database.Database | null = null;

/**
 * Materializes the base64-embedded demo database to a real file on disk so
 * better-sqlite3 can open it. /tmp is the one place guaranteed writable in a
 * Vercel serverless function even though the rest of the filesystem is
 * read-only at request time; the write only happens once per warm instance.
 */
function materializeDemoDb(): string {
  const tmpPath = path.join(os.tmpdir(), "market-outreach-demo.db");
  const buffer = Buffer.from(DEMO_DB_BASE64, "base64");
  if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size !== buffer.length) {
    fs.writeFileSync(tmpPath, buffer);
  }
  return tmpPath;
}

/**
 * Opens (or reuses) the SQLite connection and ensures the schema exists.
 * In DEMO_READ_ONLY mode (public Vercel deploy), opens a copy of the
 * embedded demo database read-only instead — unless SEED_DB_PATH is also
 * set, which means this is the build-time seeding step generating that
 * snapshot and needs a normal read-write connection. See paths.ts.
 */
export function getDb(dbPath: string = defaultDbPath()): Database.Database {
  if (sharedDb) return sharedDb;

  const readonly = isDemoReadOnly() && !process.env.SEED_DB_PATH;
  const resolvedPath = readonly ? materializeDemoDb() : dbPath;
  const db = new Database(resolvedPath, readonly ? { readonly: true, fileMustExist: true } : undefined);

  if (!readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    // Resolved from the repo root rather than __dirname — bundlers (e.g. Next.js's
    // server build) rewrite __dirname for compiled chunks, which breaks a relative
    // lookup of the non-JS schema.sql asset.
    const schemaPath = path.join(findRepoRoot(), "packages", "db", "src", "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    db.exec(schema);
  }

  sharedDb = db;
  return db;
}

/** Closes the shared connection — used by scripts that need a clean handle (e.g. reset-db). */
export function closeDb(): void {
  if (sharedDb) {
    sharedDb.close();
    sharedDb = null;
  }
}
