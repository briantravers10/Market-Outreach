-- Prospecting system skeleton schema. SQLite, single local file, fake data only.
-- This is an internal research/scoring store — it is NOT a CRM. See mock_crm_records
-- for the seam that previews how qualified leads would later flow into a real CRM.

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  industry TEXT NOT NULL,
  status TEXT NOT NULL,
  batch_size INTEGER NOT NULL,
  priority INTEGER NOT NULL,
  target_lead_count INTEGER NOT NULL,
  filters TEXT NOT NULL DEFAULT '[]',
  source_command TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  city TEXT NOT NULL,
  industry TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_campaign ON jobs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_city_industry ON jobs(city, industry);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  website TEXT,
  website_status TEXT NOT NULL,
  website_quality TEXT NOT NULL,
  online_booking_status TEXT NOT NULL,
  booking_provider TEXT,
  booking_method TEXT NOT NULL,
  staff_count INTEGER,
  staff_count_confidence TEXT NOT NULL,
  rating REAL,
  review_count INTEGER,
  instagram TEXT,
  facebook TEXT,
  social_activity TEXT NOT NULL,
  location_count INTEGER,
  services TEXT NOT NULL DEFAULT '[]',
  prospect_score INTEGER,
  score_breakdown TEXT NOT NULL DEFAULT '[]',
  score_reason TEXT,
  data_confidence TEXT NOT NULL,
  discovery_source TEXT NOT NULL,
  external_id TEXT,
  source_confidence REAL,
  latitude REAL,
  longitude REAL,
  date_discovered TEXT NOT NULL,
  date_last_researched TEXT,
  research_status TEXT NOT NULL,
  qualification_status TEXT NOT NULL,
  pipeline_stage TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  job_id TEXT NOT NULL REFERENCES jobs(id),
  is_duplicate_of TEXT,
  stages_completed TEXT NOT NULL DEFAULT '[]',
  link_in_bio_url TEXT,
  detected_links TEXT NOT NULL DEFAULT '[]',
  service_area TEXT,
  location_confidence TEXT NOT NULL DEFAULT 'UNKNOWN',
  location_evidence TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_city_industry ON leads(city, industry);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(prospect_score);
CREATE INDEX IF NOT EXISTS idx_leads_qualification ON leads(qualification_status);
-- Re-importing a source must update rather than duplicate, and that lookup runs
-- once per row across tens of thousands of rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_external_id ON leads(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_state ON leads(state);
CREATE INDEX IF NOT EXISTS idx_leads_zip ON leads(zip);

CREATE TABLE IF NOT EXISTS mock_crm_records (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  stage TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  external_crm_name TEXT NOT NULL,
  -- Ids the CRM assigned. These are what make a re-sync an update rather than
  -- a duplicate, and what a stage update actually addresses.
  external_org_id TEXT,
  external_person_id TEXT,
  external_deal_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_crm_lead ON mock_crm_records(lead_id);

CREATE TABLE IF NOT EXISTS outreach_log (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  note TEXT NOT NULL
);

-- Phase 2: hybrid AI prospecting team. Agent *identity* is config-driven
-- (config/agents.json), not stored here — this is only the append-only
-- record of what each agent persona actually did, which is also how each
-- agent's live "status" / "current task" get derived (no separate mutable
-- agent-state to fall out of sync).
CREATE TABLE IF NOT EXISTS agent_activity (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  campaign_id TEXT REFERENCES campaigns(id),
  job_id TEXT REFERENCES jobs(id),
  lead_id TEXT REFERENCES leads(id),
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_activity_agent ON agent_activity(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_activity_campaign ON agent_activity(campaign_id);

-- Formalizes what was previously only job.status = 'human_review'.
CREATE TABLE IF NOT EXISTS human_review_items (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id),
  lead_id TEXT REFERENCES leads(id),
  agent_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_human_review_status ON human_review_items(status);

-- One row per scoring pass (the Qualifier scores a lead once per job run).
-- leads.prospect_score/score_breakdown/etc. stay the fast-access current
-- value; this is the history/audit trail, and the seam for re-scoring
-- history once scoring-config weights change.
CREATE TABLE IF NOT EXISTS score_results (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  score INTEGER NOT NULL,
  breakdown TEXT NOT NULL DEFAULT '[]',
  confidence TEXT NOT NULL,
  confidence_reason TEXT NOT NULL,
  score_reason TEXT NOT NULL,
  scoring_config_version INTEGER NOT NULL,
  scored_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_score_results_lead ON score_results(lead_id);

-- Dashboard authentication. Separate from everything above: this is about who
-- may look at the prospecting data, not about the data itself.
-- The deployed demo opens this database read-only, so a bootstrap admin can
-- also be supplied via ADMIN_EMAIL/ADMIN_PASSWORD_HASH environment variables
-- and login still works with no write. See packages/core/src/auth/session.ts.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(lower(email));

-- Only the SHA-256 hash of a reset token is stored; the raw token exists only
-- in the emailed link. used_at makes a token single-use.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_hash ON password_reset_tokens(token_hash);

-- ===========================================================================
-- AI Manager (see supabase/migrations/20260824090000_ai_manager.sql — kept
-- deliberately identical; these tables use only TEXT/INTEGER so one body is
-- valid in both dialects).
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- Conversations — what the owner said, and what the Manager said back.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS manager_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  -- When set, the conversation is "focused" on one employee, so follow-up
  -- instructions without an explicit target route to them ("let me talk to
  -- the Scout" ... "you're finding too many chains").
  focus_agent_id TEXT,
  started_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON manager_conversations(last_message_at);

CREATE TABLE IF NOT EXISTS manager_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES manager_conversations(id),
  -- 'owner'   — what the human said
  -- 'manager' — the Manager replying
  -- 'agent'   — the Manager relaying an employee's voice (agent_id says which)
  -- 'system'  — a state change worth showing in the transcript
  role TEXT NOT NULL,
  agent_id TEXT,
  content TEXT NOT NULL,
  -- Which intent the brain resolved this to, and which brain resolved it.
  -- Kept so a wrong route can be diagnosed after the fact.
  intent TEXT,
  brain TEXT,
  -- JSON array of {tool, params, status} for what this turn actually ran.
  tool_calls TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON manager_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_created ON manager_messages(created_at);

-- ---------------------------------------------------------------------------
-- Instructions — the owner's standing and one-off orders to an employee.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_instructions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  instruction TEXT NOT NULL,
  -- 'permanent' — a standing rule, active until superseded or revoked
  -- 'temporary' — applies until expires_at (and/or to one campaign only)
  scope TEXT NOT NULL,
  -- 'active' | 'superseded' | 'revoked' | 'expired'
  status TEXT NOT NULL DEFAULT 'active',
  -- A machine-applicable effect, as JSON, when the instruction was recognized
  -- as one the pipeline can genuinely enforce. NULL means advisory: recorded
  -- and shown to the employee, but not automatically applied. The distinction
  -- is surfaced in the UI rather than glossed over — an instruction that
  -- silently does nothing would be worse than no instruction at all.
  effect TEXT,
  effect_kind TEXT,
  -- Why the owner asked for it, when they said. Answers "why did we change
  -- this rule?" months later.
  rationale TEXT,
  -- Provenance, so every rule traces back to the sentence that created it.
  source TEXT NOT NULL DEFAULT 'manager_conversation',
  conversation_id TEXT REFERENCES manager_conversations(id),
  message_id TEXT REFERENCES manager_messages(id),
  created_by TEXT NOT NULL DEFAULT 'owner',
  -- Version chain: a new instruction that replaces an old one points back at
  -- it, and the old row is marked superseded rather than edited or deleted.
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_id TEXT,
  superseded_by_id TEXT,
  -- Temporary-scope binding.
  campaign_id TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_instructions_agent ON agent_instructions(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_instructions_created ON agent_instructions(created_at);
CREATE INDEX IF NOT EXISTS idx_instructions_campaign ON agent_instructions(campaign_id);

-- ---------------------------------------------------------------------------
-- Actions — every tool the Manager ran, including the ones it asked about
-- first and the ones that were refused.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS manager_actions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES manager_conversations(id),
  message_id TEXT REFERENCES manager_messages(id),
  agent_id TEXT,
  tool TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  -- 'low' runs immediately; 'medium' and 'high' need the owner to confirm.
  risk TEXT NOT NULL DEFAULT 'low',
  -- 'pending_approval' | 'approved' | 'rejected' | 'running' | 'succeeded' | 'failed'
  status TEXT NOT NULL,
  -- What the Manager said it was going to do, captured BEFORE it ran, so an
  -- approval record shows what was actually approved.
  intent_summary TEXT NOT NULL DEFAULT '',
  result_summary TEXT,
  error TEXT,
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_actions_status ON manager_actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_requested ON manager_actions(requested_at);
CREATE INDEX IF NOT EXISTS idx_actions_conversation ON manager_actions(conversation_id);

-- ---------------------------------------------------------------------------
-- Reports — every generated report, kept forever.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  -- 'daily' | 'weekly' | 'briefing' | 'custom'
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  -- The numbers the summary was written from, so an old report can be
  -- re-read or re-rendered without recomputing against changed data.
  metrics TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL,
  -- 'manager' | 'schedule' | 'owner'
  generated_by TEXT NOT NULL DEFAULT 'manager',
  scheduled_task_id TEXT,
  generated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type, generated_at);
CREATE INDEX IF NOT EXISTS idx_reports_generated ON reports(generated_at);

-- ---------------------------------------------------------------------------
-- Scheduled tasks — "every morning at 9" as a stored row, not a promise.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- 'daily_report' | 'weekly_report'
  kind TEXT NOT NULL,
  -- The owner's sentence that created it, kept verbatim.
  instruction TEXT NOT NULL DEFAULT '',
  -- Local wall-clock the owner asked for, plus the IANA zone it's relative to.
  -- Stored as parts rather than a cron string so it can be displayed back in
  -- the owner's own terms and re-evaluated if the zone changes.
  hour INTEGER NOT NULL DEFAULT 9,
  minute INTEGER NOT NULL DEFAULT 0,
  -- 0=Sunday..6=Saturday for weekly; NULL for daily.
  day_of_week INTEGER,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  active INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_run_status TEXT,
  next_run_at TEXT,
  conversation_id TEXT REFERENCES manager_conversations(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_active ON scheduled_tasks(active, next_run_at);
