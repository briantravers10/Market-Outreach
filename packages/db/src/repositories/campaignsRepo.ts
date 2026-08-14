import type Database from "better-sqlite3";
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
  created_at: string;
  updated_at: string;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteCampaignsRepository implements CampaignsRepository {
  constructor(private readonly db: Database.Database) {}

  create(campaign: Campaign): Campaign {
    this.db
      .prepare(
        `INSERT INTO campaigns (id, name, city, industry, status, batch_size, priority, target_lead_count, created_at, updated_at)
         VALUES (@id, @name, @city, @industry, @status, @batchSize, @priority, @targetLeadCount, @createdAt, @updatedAt)`
      )
      .run(campaign);
    return campaign;
  }

  update(campaign: Campaign): Campaign {
    this.db
      .prepare(
        `UPDATE campaigns SET name=@name, status=@status, batch_size=@batchSize, priority=@priority,
         target_lead_count=@targetLeadCount, updated_at=@updatedAt WHERE id=@id`
      )
      .run(campaign);
    return campaign;
  }

  getById(id: string): Campaign | null {
    const row = this.db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as CampaignRow | undefined;
    return row ? rowToCampaign(row) : null;
  }

  list(): Campaign[] {
    const rows = this.db.prepare("SELECT * FROM campaigns ORDER BY created_at DESC").all() as CampaignRow[];
    return rows.map(rowToCampaign);
  }
}
