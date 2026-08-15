import type Database from "better-sqlite3";
import type { AgentActivity, AgentActivityLevel, AgentActivityRepository, AgentId } from "@market-outreach/core";

interface AgentActivityRow {
  id: string;
  agent_id: string;
  campaign_id: string | null;
  job_id: string | null;
  lead_id: string | null;
  action: string;
  summary: string;
  level: string;
  created_at: string;
}

function rowToActivity(row: AgentActivityRow): AgentActivity {
  return {
    id: row.id,
    agentId: row.agent_id as AgentId,
    campaignId: row.campaign_id,
    jobId: row.job_id,
    leadId: row.lead_id,
    action: row.action,
    summary: row.summary,
    level: row.level as AgentActivityLevel,
    createdAt: row.created_at,
  };
}

export class SqliteAgentActivityRepository implements AgentActivityRepository {
  constructor(private readonly db: Database.Database) {}

  log(activity: AgentActivity): AgentActivity {
    this.db
      .prepare(
        `INSERT INTO agent_activity (id, agent_id, campaign_id, job_id, lead_id, action, summary, level, created_at)
         VALUES (@id, @agentId, @campaignId, @jobId, @leadId, @action, @summary, @level, @createdAt)`
      )
      .run(activity);
    return activity;
  }

  list(filter: { agentId?: AgentId; campaignId?: string; limit?: number } = {}): AgentActivity[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.agentId) { clauses.push("agent_id = @agentId"); params.agentId = filter.agentId; }
    if (filter.campaignId) { clauses.push("campaign_id = @campaignId"); params.campaignId = filter.campaignId; }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.limit = filter.limit ?? 100;
    const rows = this.db
      .prepare(`SELECT * FROM agent_activity ${where} ORDER BY created_at DESC LIMIT @limit`)
      .all(params) as AgentActivityRow[];
    return rows.map(rowToActivity);
  }
}
