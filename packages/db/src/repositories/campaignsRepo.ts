import type { SqlClient } from "../sqlClient";
import type { Campaign, CampaignsRepository, CampaignStatus } from "@market-outreach/core";

interface CampaignRow {
  id: string;
  name: string;
  city: string;
  industry: string;
  status: string;
  batch_size: number;
  priority: number;
  target_lead_count: number;
  filters: string;
  source_command: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function rowToCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    industry: row.industry,
    status: row.status as CampaignStatus,
    batchSize: row.batch_size,
    priority: row.priority,
    targetLeadCount: row.target_lead_count,
    filters: JSON.parse(row.filters),
    sourceCommand: row.source_command,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export class SqliteCampaignsRepository implements CampaignsRepository {
  constructor(private readonly db: SqlClient) {}

  async create(campaign: Campaign): Promise<Campaign> {
    await this.db
      .prepare(
        `INSERT INTO campaigns (
          id, name, city, industry, status, batch_size, priority, target_lead_count,
          filters, source_command, created_at, updated_at, started_at, completed_at
        ) VALUES (
          @id, @name, @city, @industry, @status, @batchSize, @priority, @targetLeadCount,
          @filters, @sourceCommand, @createdAt, @updatedAt, @startedAt, @completedAt
        )`
      )
      .run({ ...campaign, filters: JSON.stringify(campaign.filters) });
    return campaign;
  }

  async update(campaign: Campaign): Promise<Campaign> {
    await this.db
      .prepare(
        `UPDATE campaigns SET name=@name, status=@status, batch_size=@batchSize, priority=@priority,
         target_lead_count=@targetLeadCount, filters=@filters, updated_at=@updatedAt,
         started_at=@startedAt, completed_at=@completedAt WHERE id=@id`
      )
      .run({ ...campaign, filters: JSON.stringify(campaign.filters) });
    return campaign;
  }

  async getById(id: string): Promise<Campaign | null> {
    const row = await this.db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as CampaignRow | undefined;
    return row ? rowToCampaign(row) : null;
  }

  async list(): Promise<Campaign[]> {
    const rows = await this.db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all() as CampaignRow[];
    return rows.map(rowToCampaign);
  }
}
