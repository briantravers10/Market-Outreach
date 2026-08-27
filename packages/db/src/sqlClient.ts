import type Database from "better-sqlite3";
import { Pool } from "pg";

/**
 * A minimal statement API shared by both backends.
 *
 * The repositories are written once against this, so SQLite (local) and
 * Postgres (deployed) run *the same SQL* through *the same row-mapping code*.
 * Two hand-written repository sets would have been twice the code and twice
 * the places for the backends to quietly disagree about, say, how a null is
 * stored or how an upsert resolves.
 *
 * Everything is async. better-sqlite3 is synchronous and simply resolves
 * immediately; Postgres actually goes over the wire.
 */
export interface SqlStatement {
  // Varargs, mirroring better-sqlite3: either a single object of named
  // parameters, or a list of positional ones. Keeping that convention means
  // the repository call sites didn't have to change at all.
  get<T>(...params: unknown[]): Promise<T | undefined>;
  all<T>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<void>;
}

export interface SqlClient {
  prepare(sql: string): SqlStatement;
  /** Runs multi-statement DDL. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  readonly dialect: "sqlite" | "postgres";
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

export function createSqliteClient(db: Database.Database): SqlClient {
  return {
    dialect: "sqlite",
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        async get<T>(...params: unknown[]) {
          return stmt.get(...(params as never[])) as T | undefined;
        },
        async all<T>(...params: unknown[]) {
          return stmt.all(...(params as never[])) as T[];
        },
        async run(...params: unknown[]) {
          stmt.run(...(params as never[]));
        },
      };
    },
    async exec(sql) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

/**
 * Rewrites better-sqlite3's parameter styles into Postgres positional
 * placeholders, so the repository SQL doesn't have to know which backend it's
 * talking to.
 *
 *   `@name`  -> $1, $2 ...  (named; repeats reuse the same index)
 *   `?`      -> $1, $2 ...  (positional)
 *
 * String literals are skipped, so an `@` or `?` inside quotes is left alone.
 */
export function toPositional(sql: string, params: unknown[]): { text: string; values: unknown[] } {
  if (params.length === 0) return { text: sql, values: [] };

  const values: unknown[] = [];

  // A lone plain object means named parameters (@name); anything else is a
  // positional list (?), matching how better-sqlite3 is called.
  const named =
    params.length === 1 &&
    typeof params[0] === "object" &&
    params[0] !== null &&
    !Array.isArray(params[0]);

  if (!named) {
    const positional = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
    let i = 0;
    const text = replaceOutsideStrings(sql, /\?/g, () => {
      values.push(positional[i]);
      i += 1;
      return `$${values.length}`;
    });
    return { text, values };
  }

  const record = params[0] as Record<string, unknown>;
  const indexByName = new Map<string, number>();
  const text = replaceOutsideStrings(sql, /@([a-zA-Z_]\w*)/g, (_m, name: string) => {
    const existing = indexByName.get(name);
    if (existing) return `$${existing}`;
    values.push(record[name] ?? null);
    indexByName.set(name, values.length);
    return `$${values.length}`;
  });

  return { text, values };
}

/** Applies a replacement only outside single-quoted SQL string literals. */
function replaceOutsideStrings(
  sql: string,
  pattern: RegExp,
  replacer: (match: string, ...groups: string[]) => string
): string {
  const segments: string[] = [];
  let cursor = 0;
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "'") {
      if (!inString) {
        segments.push(sql.slice(cursor, i).replace(pattern, replacer as never));
        cursor = i;
        inString = true;
      } else if (sql[i + 1] === "'") {
        i += 1; // escaped quote inside the literal
      } else {
        segments.push(sql.slice(cursor, i + 1));
        cursor = i + 1;
        inString = false;
      }
    }
  }
  segments.push(inString ? sql.slice(cursor) : sql.slice(cursor).replace(pattern, replacer as never));
  return segments.join("");
}

let sharedPool: Pool | null = null;

function getPool(connectionString: string): Pool {
  if (sharedPool) return sharedPool;
  sharedPool = new Pool({
    connectionString,
    // Serverless: many short-lived instances, each wanting a connection.
    // Supabase's transaction pooler fronts this, so keep per-instance
    // connections low and let idle ones close quickly.
    // Raised from 3 on evidence: four concurrent crawl workers plus the
    // website sweep exhausted it, and a run died on its closing query having
    // done all the work. Supabase's transaction pooler fronts this and
    // multiplexes far more than one connection per client, so a handful per
    // instance is well within what it expects.
    max: 8,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // TLS for anything remote. Skipped for localhost, which has no certificate
    // and is only ever used for local testing.
    ssl: /(?:localhost|127\.0\.0\.1)/.test(connectionString) ? undefined : { rejectUnauthorized: false },
  });
  // A pool error must never take the process down — a dropped idle connection
  // is routine on a pooled/serverless setup.
  sharedPool.on("error", () => {});
  return sharedPool;
}

/**
 * Failures that happened while GETTING a connection, before any SQL was sent.
 *
 * The distinction is what makes retrying safe. A statement that timed out
 * mid-execution may well have committed, and re-running it could double a
 * write; a statement that never reached the server cannot have done anything.
 * Only the second kind is matched here, and the list is deliberately narrow —
 * anything unrecognised is treated as "may have run" and is not retried.
 */
function isConnectionAcquisitionFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /connection terminated due to connection timeout/i.test(message) ||
    /timeout exceeded when trying to connect/i.test(message) ||
    /connection terminated unexpectedly/i.test(message) ||
    /ECONNRESET/.test(message) ||
    /ECONNREFUSED/.test(message)
  );
}

export function createPostgresClient(connectionString: string): SqlClient {
  const pool = getPool(connectionString);

  /**
   * One retry, and only when the query provably never ran.
   *
   * Two cron jobs firing on the same minute was enough to exhaust the pooler
   * and kill an entire run of work on its very first query — a batch of a
   * hundred and twenty leads abandoned because one connection could not be
   * obtained for ten seconds. The schedules are staggered now, but a shared
   * pooler will always have moments of contention, and losing a whole run to
   * one of them is not a reasonable response to it.
   */
  const withRetry = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (!isConnectionAcquisitionFailure(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 750));
      return run();
    }
  };

  return {
    dialect: "postgres",
    prepare(sql) {
      return {
        async get<T>(...params: unknown[]) {
          const { text, values } = toPositional(sql, params);
          const result = await withRetry(() => pool.query(text, values));
          return result.rows[0] as T | undefined;
        },
        async all<T>(...params: unknown[]) {
          const { text, values } = toPositional(sql, params);
          const result = await withRetry(() => pool.query(text, values));
          return result.rows as T[];
        },
        async run(...params: unknown[]) {
          const { text, values } = toPositional(sql, params);
          await withRetry(() => pool.query(text, values));
        },
      };
    },
    async exec(sql) {
      await withRetry(() => pool.query(sql));
    },
    async close() {
      await pool.end();
      sharedPool = null;
    },
  };
}
