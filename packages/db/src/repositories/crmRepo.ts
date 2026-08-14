import type Database from "better-sqlite3";
import type { CrmRecord, CrmRepository, PipelineStage } from "@market-outreach/core";

interface CrmRow {
  id: string;
  lead_id: string;
  stage: string;
  synced_at: string;
  external_crm_name: string;
}

function rowToRecord(row: CrmRow): CrmRecord {
  return {
    id: row.id,
    leadId: row.lead_id,
    stage: row.stage as PipelineStage,
    syncedAt: row.synced_at,
    externalCrmName: row.external_crm_name,
  };
}

/** Backs the future-CRM preview (mock_crm_records) — not a real CRM integration. */
export class SqliteCrmRepository implements CrmRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(record: CrmRecord): CrmRecord {
    this.db
      .prepare(
        `INSERT INTO mock_crm_records (id, lead_id, stage, synced_at, external_crm_name)
         VALUES (@id, @leadId, @stage, @syncedAt, @externalCrmName)
         ON CONFLICT(id) DO UPDATE SET stage=excluded.stage, synced_at=excluded.synced_at`
      )
      .run(record);
    return record;
  }

  listByLead(leadId: string): CrmRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM mock_crm_records WHERE lead_id = ? ORDER BY synced_at DESC")
      .all(leadId) as CrmRow[];
    return rows.map(rowToRecord);
  }

  list(): CrmRecord[] {
    const rows = this.db.prepare("SELECT * FROM mock_crm_records ORDER BY synced_at DESC").all() as CrmRow[];
    return rows.map(rowToRecord);
  }
}
