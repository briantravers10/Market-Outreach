import type { SqlClient } from "../sqlClient";
import type { AgentId, HumanReviewItem, HumanReviewRepository, HumanReviewStatus } from "@market-outreach/core";

interface HumanReviewRow {
  id: string;
  job_id: string | null;
  lead_id: string | null;
  agent_id: string;
  reason: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

function rowToItem(row: HumanReviewRow): HumanReviewItem {
  return {
    id: row.id,
    jobId: row.job_id,
    leadId: row.lead_id,
    agentId: row.agent_id as AgentId,
    reason: row.reason,
    status: row.status as HumanReviewStatus,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export class SqliteHumanReviewRepository implements HumanReviewRepository {
  constructor(private readonly db: SqlClient) {}

  async create(item: HumanReviewItem): Promise<HumanReviewItem> {
    await this.db
      .prepare(
        `INSERT INTO human_review_items (id, job_id, lead_id, agent_id, reason, status, created_at, resolved_at)
         VALUES (@id, @jobId, @leadId, @agentId, @reason, @status, @createdAt, @resolvedAt)`
      )
      .run(item);
    return item;
  }

  async list(filter: { status?: HumanReviewStatus; agentId?: AgentId } = {}): Promise<HumanReviewItem[]> {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.status) { clauses.push("status = @status"); params.status = filter.status; }
    if (filter.agentId) { clauses.push("agent_id = @agentId"); params.agentId = filter.agentId; }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db
      .prepare(`SELECT * FROM human_review_items ${where} ORDER BY created_at DESC`)
      .all(params) as HumanReviewRow[];
    return rows.map(rowToItem);
  }
}
