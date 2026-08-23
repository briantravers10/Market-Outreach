import type { SqlClient } from "../sqlClient";
import type { CrmRecord, CrmRepository, PipelineStage } from "@market-outreach/core";

interface CrmRow {
  id: string;
  lead_id: string;
  stage: string;
  synced_at: string;
  external_crm_name: string;
  external_org_id: string | null;
  external_person_id: string | null;
  external_deal_id: string | null;
}

function rowToRecord(row: CrmRow): CrmRecord {
  return {
    id: row.id,
    leadId: row.lead_id,
    stage: row.stage as PipelineStage,
    syncedAt: row.synced_at,
    externalCrmName: row.external_crm_name,
    externalOrgId: row.external_org_id,
    externalPersonId: row.external_person_id,
    externalDealId: row.external_deal_id,
  };
}

/** Backs the future-CRM preview (mock_crm_records) — not a real CRM integration. */
export class SqliteCrmRepository implements CrmRepository {
  constructor(private readonly db: SqlClient) {}

  async upsert(record: CrmRecord): Promise<CrmRecord> {
    await this.db
      .prepare(
        `INSERT INTO mock_crm_records
           (id, lead_id, stage, synced_at, external_crm_name, external_org_id, external_person_id, external_deal_id)
         VALUES
           (@id, @leadId, @stage, @syncedAt, @externalCrmName, @externalOrgId, @externalPersonId, @externalDealId)
         ON CONFLICT(id) DO UPDATE SET
           stage=excluded.stage, synced_at=excluded.synced_at,
           external_org_id=excluded.external_org_id,
           external_person_id=excluded.external_person_id,
           external_deal_id=excluded.external_deal_id`
      )
      .run(record);
    return record;
  }

  async listByLead(leadId: string): Promise<CrmRecord[]> {
    const rows = await this.db
      .prepare("SELECT * FROM mock_crm_records WHERE lead_id = ? ORDER BY synced_at DESC")
      .all(leadId) as CrmRow[];
    return rows.map(rowToRecord);
  }

  async list(): Promise<CrmRecord[]> {
    const rows = await this.db.prepare("SELECT * FROM mock_crm_records ORDER BY synced_at DESC").all() as CrmRow[];
    return rows.map(rowToRecord);
  }
}
