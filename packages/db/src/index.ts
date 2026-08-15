import type { Repositories } from "@market-outreach/core";
import { getDb, closeDb } from "./client";
import { defaultDbPath } from "./paths";
import { SqliteLeadsRepository } from "./repositories/leadsRepo";
import { SqliteJobsRepository } from "./repositories/jobsRepo";
import { SqliteCampaignsRepository } from "./repositories/campaignsRepo";
import { SqliteCrmRepository } from "./repositories/crmRepo";
import { SqliteOutreachRepository } from "./repositories/outreachRepo";
import { SqliteAgentActivityRepository } from "./repositories/agentActivityRepo";
import { SqliteHumanReviewRepository } from "./repositories/humanReviewRepo";
import { SqliteScoreResultsRepository } from "./repositories/scoreResultsRepo";

export { getDb, closeDb, defaultDbPath };

/** Wires SQLite-backed implementations into the @market-outreach/core repository ports. */
export function createRepositories(dbPath?: string): Repositories {
  const db = getDb(dbPath);
  return {
    leads: new SqliteLeadsRepository(db),
    jobs: new SqliteJobsRepository(db),
    campaigns: new SqliteCampaignsRepository(db),
    crm: new SqliteCrmRepository(db),
    outreach: new SqliteOutreachRepository(db),
    agentActivity: new SqliteAgentActivityRepository(db),
    humanReview: new SqliteHumanReviewRepository(db),
    scoreResults: new SqliteScoreResultsRepository(db),
  };
}
