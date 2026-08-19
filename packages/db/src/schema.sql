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

CREATE TABLE IF NOT EXISTS mock_crm_records (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  stage TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  external_crm_name TEXT NOT NULL
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
