import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { defaultDbPath, findRepoRoot } from "./paths";

let sharedDb: Database.Database | null = null;

/** Opens (or reuses) the single local SQLite file and ensures the schema exists. */
export function getDb(dbPath: string = defaultDbPath()): Database.Database {
  if (sharedDb) return sharedDb;

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Resolved from the repo root rather than __dirname — bundlers (e.g. Next.js's
  // server build) rewrite __dirname for compiled chunks, which breaks a relative
  // lookup of the non-JS schema.sql asset.
  const schemaPath = path.join(findRepoRoot(), "packages", "db", "src", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);

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
