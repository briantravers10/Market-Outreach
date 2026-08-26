import type { Repositories } from "@market-outreach/core";
import { getDb, closeDb } from "./client";
import { defaultDbPath } from "./paths";
import { createPostgresClient, createSqliteClient, type SqlClient } from "./sqlClient";
import { SqliteLeadsRepository } from "./repositories/leadsRepo";
import { SqlCommunicationsRepository } from "./repositories/commsRepo";
import { SqliteJobsRepository } from "./repositories/jobsRepo";
import { SqliteCampaignsRepository } from "./repositories/campaignsRepo";
import { SqliteCrmRepository } from "./repositories/crmRepo";
import { SqlCostsRepository } from "./repositories/costsRepo";
import { SqliteOutreachRepository } from "./repositories/outreachRepo";
import { SqliteAgentActivityRepository } from "./repositories/agentActivityRepo";
import { SqliteHumanReviewRepository } from "./repositories/humanReviewRepo";
import { SqliteScoreResultsRepository } from "./repositories/scoreResultsRepo";
import { createPasswordResetRepo, createUsersRepo } from "./repositories/usersRepo";
import {
  createConversationsRepo,
  createInstructionsRepo,
  createManagerActionsRepo,
  createReportsRepo,
  createScheduledTasksRepo,
} from "./repositories/managerRepo";

export { getDb, closeDb, defaultDbPath };
export { createPostgresClient, createSqliteClient, toPositional } from "./sqlClient";
export type { SqlClient, SqlStatement } from "./sqlClient";

/**
 * Which backend is in play, decided purely by whether DATABASE_URL is set.
 *
 *   DATABASE_URL set  -> Postgres (Supabase). Read-write, survives restarts.
 *   unset             -> SQLite file. Local development, and the frozen
 *                        read-only snapshot the public demo serves.
 *
 * One switch, no build flags: the same image runs either way.
 */
export function describeBackend(env: NodeJS.ProcessEnv = process.env): {
  backend: "postgres" | "sqlite";
  writable: boolean;
  detail: string;
} {
  if (env.DATABASE_URL?.trim()) {
    return { backend: "postgres", writable: true, detail: "Postgres — persistent and writable." };
  }
  if (env.DEMO_READ_ONLY === "1") {
    return {
      backend: "sqlite",
      writable: false,
      detail: "SQLite snapshot, opened read-only — the public demo. Nothing written here persists.",
    };
  }
  return { backend: "sqlite", writable: true, detail: "Local SQLite file." };
}

function createSqlClient(dbPath?: string): SqlClient {
  const url = process.env.DATABASE_URL?.trim();
  // Postgres wins whenever it's configured. The pool is created lazily inside
  // the client, so this stays a synchronous constructor and callers don't have
  // to become async just to obtain a repository.
  if (url) return createPostgresClient(url);
  return createSqliteClient(getDb(dbPath));
}

/** Wires the storage adapters into the @market-outreach/core repository ports. */
export function createRepositories(dbPath?: string): Repositories {
  const db = createSqlClient(dbPath);
  return {
    leads: new SqliteLeadsRepository(db),
    jobs: new SqliteJobsRepository(db),
    campaigns: new SqliteCampaignsRepository(db),
    crm: new SqliteCrmRepository(db),
    costs: new SqlCostsRepository(db),
    outreach: new SqliteOutreachRepository(db),
    agentActivity: new SqliteAgentActivityRepository(db),
    humanReview: new SqliteHumanReviewRepository(db),
    scoreResults: new SqliteScoreResultsRepository(db),
    users: createUsersRepo(db),
    passwordResets: createPasswordResetRepo(db),
    conversations: createConversationsRepo(db),
    instructions: createInstructionsRepo(db),
    managerActions: createManagerActionsRepo(db),
    reports: createReportsRepo(db),
    scheduledTasks: createScheduledTasksRepo(db),
    communications: new SqlCommunicationsRepository(db),
  };
}
export { SqlCommunicationsRepository } from "./repositories/commsRepo";
