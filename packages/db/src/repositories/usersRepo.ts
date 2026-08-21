import type Database from "better-sqlite3";
import type { PasswordResetRepository, PasswordResetToken, User, UsersRepository } from "@market-outreach/core";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export function createUsersRepo(db: Database.Database): UsersRepository {
  return {
    getByEmail(email) {
      // Case-insensitive: people don't type their email consistently, and
      // treating Ana@x.com as a different account from ana@x.com is a
      // lockout waiting to happen.
      const row = db
        .prepare(`SELECT * FROM users WHERE lower(email) = lower(?)`)
        .get(email.trim()) as UserRow | undefined;
      return row ? toUser(row) : null;
    },

    getById(id) {
      const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
      return row ? toUser(row) : null;
    },

    upsert(user) {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, name, created_at, updated_at, last_login_at)
         VALUES (@id, @email, @passwordHash, @name, @createdAt, @updatedAt, @lastLoginAt)
         ON CONFLICT(id) DO UPDATE SET
           email=excluded.email, password_hash=excluded.password_hash, name=excluded.name,
           updated_at=excluded.updated_at, last_login_at=excluded.last_login_at`
      ).run(user);
      return user;
    },

    list() {
      const rows = db.prepare(`SELECT * FROM users ORDER BY created_at`).all() as UserRow[];
      return rows.map(toUser);
    },

    markLoggedIn(id, at) {
      db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(at, id);
    },
  };
}

interface ResetRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

function toToken(row: ResetRow): PasswordResetToken {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdAt: row.created_at,
  };
}

export function createPasswordResetRepo(db: Database.Database): PasswordResetRepository {
  return {
    create(token) {
      db.prepare(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
         VALUES (@id, @userId, @tokenHash, @expiresAt, @usedAt, @createdAt)`
      ).run(token);
      return token;
    },

    getByHash(tokenHash) {
      const row = db
        .prepare(`SELECT * FROM password_reset_tokens WHERE token_hash = ?`)
        .get(tokenHash) as ResetRow | undefined;
      return row ? toToken(row) : null;
    },

    markUsed(id, at) {
      db.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`).run(at, id);
    },

    /** Called after a successful reset so no other outstanding link still works. */
    deleteForUser(userId) {
      db.prepare(`DELETE FROM password_reset_tokens WHERE user_id = ?`).run(userId);
    },
  };
}
