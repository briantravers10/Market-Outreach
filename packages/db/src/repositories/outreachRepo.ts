import type { SqlClient } from "../sqlClient";
import type { OutreachAttempt, OutreachChannel, OutreachRepository } from "@market-outreach/core";

interface OutreachRow {
  id: string;
  lead_id: string;
  channel: string;
  status: string;
  requested_at: string;
  note: string;
}

function rowToAttempt(row: OutreachRow): OutreachAttempt {
  return {
    id: row.id,
    leadId: row.lead_id,
    channel: row.channel as OutreachChannel,
    status: "DISABLED",
    requestedAt: row.requested_at,
    note: row.note,
  };
}

/** Logs disabled outreach attempts only — see packages/core/src/outreach/outreachService.ts. */
export class SqliteOutreachRepository implements OutreachRepository {
  constructor(private readonly db: SqlClient) {}

  async logAttempt(attempt: OutreachAttempt): Promise<OutreachAttempt> {
    await this.db
      .prepare(
        `INSERT INTO outreach_log (id, lead_id, channel, status, requested_at, note)
         VALUES (@id, @leadId, @channel, @status, @requestedAt, @note)`
      )
      .run(attempt);
    return attempt;
  }

  async list(): Promise<OutreachAttempt[]> {
    const rows = await this.db.prepare("SELECT * FROM outreach_log ORDER BY requested_at DESC").all() as OutreachRow[];
    return rows.map(rowToAttempt);
  }
}
