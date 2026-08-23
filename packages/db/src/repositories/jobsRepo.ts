import type { SqlClient } from "../sqlClient";
import type { Job, JobsRepository, JobStatus } from "@market-outreach/core";

interface JobRow {
  id: string;
  campaign_id: string;
  city: string;
  industry: string;
  batch_id: string;
  status: string;
  payload: string;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    city: row.city,
    industry: row.industry,
    batchId: row.batch_id,
    status: row.status as JobStatus,
    payload: JSON.parse(row.payload),
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteJobsRepository implements JobsRepository {
  constructor(private readonly db: SqlClient) {}

  async create(job: Job): Promise<Job> {
    await this.db
      .prepare(
        `INSERT INTO jobs (id, campaign_id, city, industry, batch_id, status, payload, attempts, error, created_at, updated_at)
         VALUES (@id, @campaignId, @city, @industry, @batchId, @status, @payload, @attempts, @error, @createdAt, @updatedAt)`
      )
      .run({ ...job, payload: JSON.stringify(job.payload) });
    return job;
  }

  async update(job: Job): Promise<Job> {
    await this.db
      .prepare(
        `UPDATE jobs SET status=@status, payload=@payload, attempts=@attempts, error=@error, updated_at=@updatedAt WHERE id=@id`
      )
      .run({ ...job, payload: JSON.stringify(job.payload) });
    return job;
  }

  async getById(id: string): Promise<Job | null> {
    const row = await this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  async list(filter: { campaignId?: string; status?: JobStatus; city?: string; industry?: string } = {}): Promise<Job[]> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.campaignId) { clauses.push("campaign_id = @campaignId"); params.campaignId = filter.campaignId; }
    if (filter.status) { clauses.push("status = @status"); params.status = filter.status; }
    if (filter.city) { clauses.push("city = @city"); params.city = filter.city; }
    if (filter.industry) { clauses.push("industry = @industry"); params.industry = filter.industry; }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.prepare(`SELECT * FROM jobs ${where} ORDER BY created_at ASC`).all(params) as JobRow[];
    return rows.map(rowToJob);
  }

  async claimNextPending(): Promise<Job | null> {
    const row = await this.db
      .prepare(`SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`)
      .get() as JobRow | undefined;
    return row ? rowToJob(row) : null;
  }
}
