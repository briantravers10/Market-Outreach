import type { SqlClient } from "../sqlClient";
import type { SettingsRepository } from "@market-outreach/core";

/**
 * Operator-set values, as plain strings.
 *
 * Deliberately untyped at the storage layer: callers parse and validate what
 * they asked for, so adding a setting never means a migration.
 */
export class SqlSettingsRepository implements SettingsRepository {
  constructor(private readonly db: SqlClient) {}

  async get(key: string): Promise<string | null> {
    const row = (await this.db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (@key, @value, @updatedAt)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run({ key, value, updatedAt: new Date().toISOString() });
  }
}
