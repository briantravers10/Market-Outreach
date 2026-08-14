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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
