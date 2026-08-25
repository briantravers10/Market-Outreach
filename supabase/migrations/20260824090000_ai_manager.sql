-- AI Manager: conversations, instructions, actions, reports, scheduling.
--
-- Additive only. Nothing in the existing prospecting tables is altered, so the
-- pipeline that already works keeps working untouched.
--
-- Same convention as the initial schema: JSON-ish columns are TEXT rather than
-- JSONB so the SQLite and Postgres adapters behave identically (both
-- JSON.parse/stringify at the edge). Timestamps are TEXT ISO-8601 for the same
-- reason.

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
