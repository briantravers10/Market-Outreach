import type { SqlClient } from "../sqlClient";
import type { ConfidenceLevel, ScoreResultRecord, ScoreResultsRepository } from "@market-outreach/core";

interface ScoreResultRow {
  id: string;
  lead_id: string;
  score: number;
  breakdown: string;
  confidence: string;
  confidence_reason: string;
  score_reason: string;
  scoring_config_version: number;
  scored_at: string;
}

function rowToRecord(row: ScoreResultRow): ScoreResultRecord {
  return {
    id: row.id,
    leadId: row.lead_id,
    score: row.score,
    breakdown: JSON.parse(row.breakdown),
    confidence: row.confidence as ConfidenceLevel,
    confidenceReason: row.confidence_reason,
    scoreReason: row.score_reason,
    scoringConfigVersion: row.scoring_config_version,
    scoredAt: row.scored_at,
  };
}

/** Append-only history of every scoring pass — see schema.sql for why this exists alongside leads' denormalized current score. */
export class SqliteScoreResultsRepository implements ScoreResultsRepository {
  constructor(private readonly db: SqlClient) {}

  async create(record: ScoreResultRecord): Promise<ScoreResultRecord> {
    await this.db
      .prepare(
        `INSERT INTO score_results (id, lead_id, score, breakdown, confidence, confidence_reason, score_reason, scoring_config_version, scored_at)
         VALUES (@id, @leadId, @score, @breakdown, @confidence, @confidenceReason, @scoreReason, @scoringConfigVersion, @scoredAt)`
      )
      .run({ ...record, breakdown: JSON.stringify(record.breakdown) });
    return record;
  }

  async listByLead(leadId: string): Promise<ScoreResultRecord[]> {
    const rows = await this.db
      .prepare(`SELECT * FROM score_results WHERE lead_id = ? ORDER BY scored_at DESC`)
      .all(leadId) as ScoreResultRow[];
    return rows.map(rowToRecord);
  }
}
