/**
 * Canonical domain types for the prospecting system.
 *
 * Pure types only — this file has zero runtime dependencies, so both
 * @market-outreach/db (storage) and apps/dashboard (UI) can depend on it
 * without creating a cycle. Repositories are expressed as *interfaces*
 * here (ports); @market-outreach/db provides the concrete adapters (SQLite
 * for local development, Postgres for deployment), which callers (scripts,
 * dashboard) inject into workers.
 *
 * Repository methods are ASYNC. They were synchronous while SQLite was the
 * only backend (better-sqlite3 is synchronous by design), but Postgres is
 * not, and a synchronous port cannot express a network round-trip. Async is
 * the honest signature for a storage boundary; SQLite just resolves instantly.
 */

// ---------------------------------------------------------------------------
// Enums (string unions so they read cleanly in JSON/SQLite and in the UI)
// ---------------------------------------------------------------------------

import type { DetectedLink } from "./enrichment/linkClassifier";
import type { CommunicationsRepository } from "./comms/types";
import type {
  ConversationsRepository,
  InstructionsRepository,
  ManagerActionsRepository,
  ReportsRepository,
  ScheduledTasksRepository,
} from "./manager/types";

/**
 * NONE and UNREACHABLE are different findings and must not be collapsed.
 *
 * NONE means the business has no website — a strong buying signal. UNREACHABLE
 * means they have one and it did not answer, which is a different sales
 * conversation and, until retried, might just be our own bad luck. Before this
 * distinction existed, a failed fetch left the lead reading EXISTS with an
 * UNKNOWN booking status, indistinguishable from one nobody had looked at.
 */
export type WebsiteStatus = "NONE" | "EXISTS" | "UNREACHABLE";
export type WebsiteQuality = "POOR" | "AVERAGE" | "GOOD" | "EXCELLENT" | "UNKNOWN";

/**
 * What booking capability exists, if any.
 *
 * UNKNOWN is not a rounding of NONE — it means nobody has looked yet. A
 * business we found in a map dataset but whose website we have not fetched has
 * an unknown booking status, and scoring it as "no online booking" would be
 * awarding points for a finding we never made. The scoring evaluators check
 * for NONE specifically, so UNKNOWN quietly scores nothing until the Website
 * Analyst has actually been.
 */
export type OnlineBookingStatus =
  | "UNKNOWN"
  | "NONE"
  | "THIRD_PARTY_BOOKING_SYSTEM"
  | "INTEGRATED_BOOKING_SYSTEM";

/** How a customer actually books, spanning both online and offline. UNKNOWN means unchecked — see OnlineBookingStatus. */
export type BookingMethod =
  | "UNKNOWN"
  | "NONE"
  | "PHONE_ONLY"
  | "SOCIAL_DM"
  | "ONLINE_THIRD_PARTY"
  | "ONLINE_INTEGRATED";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type SocialActivity = "ACTIVE" | "MODERATE" | "INACTIVE" | "UNKNOWN";

export type ResearchStatus =
  | "NOT_STARTED"
  | "DISCOVERED"
  | "ENRICHED"
  | "ANALYZED"
  | "SCORED"
  | "COMPLETE"
  | "NEEDS_REVIEW";

export type QualificationStatus = "UNQUALIFIED" | "QUALIFIED" | "HIGH_PRIORITY" | "DISQUALIFIED";

/** Mirrors the future Research -> Qualification -> CRM -> Outreach -> Follow-up -> Sale flow. */
export type PipelineStage = "RESEARCH" | "QUALIFICATION" | "CRM" | "OUTREACH" | "FOLLOW_UP" | "SALE";

export type JobStatus = "pending" | "running" | "complete" | "failed" | "retry" | "human_review" | "paused";

export type CampaignStatus = "draft" | "running" | "paused" | "complete" | "stopped";

/**
 * The hybrid AI prospecting team's persona roster. Identity (name, role,
 * description, permitted/prohibited actions) lives in config/agents.json —
 * this id is what ties activity/status back to that config entry. "crm" and
 * "outreach" are permanently-disabled placeholder personas for future phases.
 */
export type AgentId =
  | "manager"
  | "scout"
  | "researcher"
  | "website-analyst"
  | "qualifier"
  | "deduplication"
  | "reporting"
  | "crm"
  | "outreach";

/** One pipeline stage a lead has passed through — rendered as the ✓ checklist on Lead Detail. */
export type PipelineStageName = "discovery" | "enrichment" | "website_analysis" | "qualification" | "deduplication";

// ---------------------------------------------------------------------------
// Score breakdown
// ---------------------------------------------------------------------------

export interface ScoreFactorResult {
  id: string;
  label: string;
  category: string;
  points: number;
  reason: string;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreFactorResult[];
  scoreReason: string;
  confidence: ConfidenceLevel;
  confidenceReason: string;
}

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------

export interface Lead {
  id: string;
  businessName: string;
  industry: string; // industry id, see config/industries.json
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  websiteStatus: WebsiteStatus;
  websiteQuality: WebsiteQuality;
  onlineBookingStatus: OnlineBookingStatus;
  bookingProvider: string | null;
  bookingMethod: BookingMethod;
  staffCount: number | null;
  staffCountConfidence: ConfidenceLevel;
  rating: number | null;
  reviewCount: number | null;
  instagram: string | null;
  facebook: string | null;
  socialActivity: SocialActivity;
  locationCount: number | null;
  services: string[];

  prospectScore: number | null;
  scoreBreakdown: ScoreFactorResult[];
  scoreReason: string | null;
  dataConfidence: ConfidenceLevel;

  discoverySource: string;
  /**
   * The source's own identifier for this business — an Overture place id, a
   * licence number, a Google place id. Carrying it makes re-importing the same
   * dataset an update rather than a duplicate, which is what lets the lead
   * database be refreshed on a schedule instead of rebuilt.
   */
  externalId: string | null;
  /** The source's own confidence in the record, 0-1, where it publishes one. Distinct from our dataConfidence, which is about how much we managed to research. */
  sourceConfidence: number | null;
  latitude: number | null;
  longitude: number | null;
  /**
   * When their website was last fetched and read.
   *
   * Distinct from dateLastResearched, which covers the whole record. This one
   * exists so a site that timed out is marked as tried rather than retried
   * forever — without it, the few thousand dead domains in any dataset become
   * an infinite work queue that starves the leads that would actually answer.
   */
  websiteCheckedAt: string | null;
  /**
   * Which version of the research method produced this lead's current answers.
   *
   * Null means it predates versioning. Anything below ANALYSIS_VERSION was
   * judged by an older, worse method, and must not be ranked alongside leads
   * judged by the current one — a 71 from a method that only read homepages
   * does not mean what a 71 from the current method means, and silently
   * sorting them together produces a list that looks authoritative and isn't.
   */
  analysisVersion: number | null;
  dateDiscovered: string; // ISO timestamp
  dateLastResearched: string | null;
  researchStatus: ResearchStatus;
  qualificationStatus: QualificationStatus;
  pipelineStage: PipelineStage;

  /** The link-in-bio page (Linktree etc.) found for this business, if any. */
  linkInBioUrl: string | null;
  /**
   * Every link found on that page, classified by purpose. For social-first
   * businesses this is the strongest qualification evidence available: it
   * shows whether they already book online and how they take money.
   */
  detectedLinks: DetectedLink[];

  /**
   * Where this business actually operates, for businesses that have no fixed
   * premises (mobile makeup artists, trainers, detailers). Free text like
   * "Miami + 25mi" rather than a street address.
   */
  serviceArea: string | null;
  /**
   * How sure we are of the location. Deliberately separate from dataConfidence:
   * a mobile artist with a confidently-known service area and no street address
   * is well-understood, not poorly-researched.
   */
  locationConfidence: ConfidenceLevel;
  /** The signals the location was inferred from, so a human can audit the guess. */
  locationEvidence: string[];

  campaignId: string;
  jobId: string;
  isDuplicateOf: string | null;
  /** Which pipeline stages have actually run for this lead — powers the Lead Detail checklist. */
  stagesCompleted: PipelineStageName[];

  notes: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  /** scrypt hash — never the password itself. */
  passwordHash: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface PasswordResetToken {
  id: string;
  userId: string;
  /** SHA-256 of the token. The raw token is only ever in the reset link. */
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface UsersRepository {
  getByEmail(email: string): Promise<User | null>;
  getById(id: string): Promise<User | null>;
  upsert(user: User): Promise<User>;
  list(): Promise<User[]>;
  markLoggedIn(id: string, at: string): Promise<void>;
}

export interface PasswordResetRepository {
  create(token: PasswordResetToken): Promise<PasswordResetToken>;
  getByHash(tokenHash: string): Promise<PasswordResetToken | null>;
  markUsed(id: string, at: string): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
}

/** Fields a Discovery worker is responsible for producing. */
export type DiscoveredLeadSeed = Pick<
  Lead,
  "businessName" | "industry" | "address" | "city" | "state" | "zip" | "discoverySource"
>;

// ---------------------------------------------------------------------------
// Work queue
// ---------------------------------------------------------------------------

export interface Job {
  id: string;
  campaignId: string;
  city: string;
  industry: string;
  batchId: string;
  status: JobStatus;
  /** Checkpoint payload — lets a worker resume mid-pipeline instead of restarting. */
  payload: Record<string, unknown>;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------

export interface Campaign {
  id: string;
  name: string;
  city: string;
  industry: string;
  status: CampaignStatus;
  batchSize: number;
  priority: number; // 1 (low) - 5 (high)
  targetLeadCount: number;
  /** Human-readable filter phrases parsed from the Manager command, e.g. "No online booking preferred". Display-only this phase. */
  filters: string[];
  /** The raw natural-language instruction that created this campaign, if any (vs. created via the New Campaign form). */
  sourceCommand: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CampaignProgress {
  campaignId: string;
  totalJobs: number;
  pendingJobs: number;
  runningJobs: number;
  completeJobs: number;
  failedJobs: number;
  leadsDiscovered: number;
  leadsQualified: number;
  completionPct: number;
}

// ---------------------------------------------------------------------------
// Mock CRM (future CRM integration preview)
// ---------------------------------------------------------------------------

export interface CrmRecord {
  id: string;
  leadId: string;
  stage: PipelineStage;
  syncedAt: string;
  externalCrmName: string; // e.g. "mock-crm", "pipedrive", "pipedrive (dry-run)"
  /**
   * Ids assigned by the CRM itself. Without these a re-sync has no way to know
   * a record already exists, so it creates a second one — and a stage update
   * has nothing real to address. Null until a live sync has actually run.
   */
  externalOrgId: string | null;
  externalPersonId: string | null;
  externalDealId: string | null;
}

// ---------------------------------------------------------------------------
// Outreach (disabled in this phase)
// ---------------------------------------------------------------------------

export type OutreachChannel = "email" | "sms";

export interface OutreachAttempt {
  id: string;
  leadId: string;
  channel: OutreachChannel;
  status: "DISABLED";
  requestedAt: string;
  note: string;
}

// ---------------------------------------------------------------------------
// Agent activity (Phase 2: hybrid AI prospecting team)
// ---------------------------------------------------------------------------

export type AgentActivityLevel = "info" | "error" | "human_review";

export interface AgentActivity {
  id: string;
  agentId: AgentId;
  campaignId: string | null;
  jobId: string | null;
  leadId: string | null;
  action: string;
  summary: string;
  level: AgentActivityLevel;
  createdAt: string;
}

export type HumanReviewStatus = "open" | "resolved";

export interface HumanReviewItem {
  id: string;
  jobId: string | null;
  leadId: string | null;
  agentId: AgentId;
  reason: string;
  status: HumanReviewStatus;
  createdAt: string;
  resolvedAt: string | null;
}

/** One row per scoring pass — the audit trail behind a lead's current (denormalized) score fields. */
export interface ScoreResultRecord {
  id: string;
  leadId: string;
  score: number;
  breakdown: ScoreFactorResult[];
  confidence: ConfidenceLevel;
  confidenceReason: string;
  scoreReason: string;
  scoringConfigVersion: number;
  scoredAt: string;
}

// ---------------------------------------------------------------------------
// Repository ports (implemented by @market-outreach/db)
// ---------------------------------------------------------------------------

export interface LeadsRepository {
  upsert(lead: Lead): Promise<Lead>;
  /**
   * Writes many leads in one round trip.
   *
   * A statewide import is tens of thousands of rows, and one INSERT each over
   * a connection pooler turns a forty-second job into an hour. Implementations
   * must chunk internally — both backends cap how many bound parameters a
   * single statement may carry.
   */
  upsertMany(leads: Lead[]): Promise<number>;
  /**
   * Bulk upsert keyed on the source's own id rather than ours.
   *
   * This is what makes a re-import cheap. Matching on our primary key would
   * mean loading every existing lead first to discover which ids to reuse —
   * work that grows with the table, so importing the last chunk of a state
   * would cost more than importing the first. Letting the database resolve the
   * conflict on external_id removes that read entirely, and the existing row
   * keeps its id, so anything already pointing at the lead still resolves.
   *
   * Leads without an externalId are rejected rather than silently inserted:
   * they would every one of them conflict with nothing and pile up as
   * duplicates on the next run.
   */
  upsertManyByExternalId(leads: Lead[]): Promise<number>;
  /** Row count matching a filter, without hydrating the rows. */
  count(filter?: LeadFilter): Promise<number>;
  /**
   * Counts grouped by one column, computed in SQL.
   *
   * Exists because the dashboards were reducing the entire leads table in
   * JavaScript to render a handful of tiles. That is fine at a thousand rows
   * and fatal at seventy-seven thousand: several pages poll every few seconds,
   * and each poll was pulling the whole table across a connection pooler until
   * the pool ran out. A GROUP BY returns a dozen rows instead.
   */
  groupCount(column: LeadGroupColumn, filter?: LeadFilter): Promise<LeadGroupCount[]>;
  /** Headline aggregates for the Overview and Analytics pages, in one round trip. */
  summaryStats(filter?: LeadFilter): Promise<LeadSummaryStats>;
  getById(id: string): Promise<Lead | null>;
  list(filter?: LeadFilter): Promise<Lead[]>;
  findPossibleDuplicates(lead: Pick<Lead, "businessName" | "address" | "phone" | "city">): Promise<Lead[]>;
}

export interface LeadFilter {
  city?: string;
  /** Two-letter state code. The top of the geographic hierarchy once this goes national. */
  state?: string;
  /** Five-digit ZIP. A filter and a clustering key, deliberately not the organising spine — ZIPs are postal routes and do not nest inside cities. */
  zip?: string;
  industry?: string;
  minScore?: number;
  maxScore?: number;
  websiteStatus?: WebsiteStatus;
  onlineBookingStatus?: OnlineBookingStatus;
  bookingProvider?: string;
  minStaffCount?: number;
  minReviewCount?: number;
  dataConfidence?: ConfidenceLevel;
  researchStatus?: ResearchStatus;
  qualificationStatus?: QualificationStatus;
  campaignId?: string;
  /**
   * Maximum rows to return.
   *
   * Not optional in spirit: a statewide import is tens of thousands of leads,
   * and a page that renders all of them is a page that times out. Callers that
   * genuinely need everything (the CSV export) pass a high limit knowingly.
   */
  limit?: number;
  offset?: number;
  /** Highest score first is what you want when working a call list; newest first is what you want when checking an import. */
  orderBy?: "score" | "discovered" | "name";
  /** Only leads that have a website nobody has read yet — the work queue for the Website Analyst. */
  awaitingWebsiteCheck?: boolean;
  /**
   * Leads whose site did not answer, last tried before this ISO timestamp.
   *
   * The retry queue, and deliberately time-bounded: a domain that was down an
   * hour ago is usually still down, while one that failed a week ago is worth
   * another look. Without the bound a retry pass would just re-fail the same
   * dead domains on every run and never reach the recoverable ones.
   */
  unreachableCheckedBefore?: string;
  /**
   * Leads already checked, whose answer the current analysis could improve on.
   *
   * The re-sweep queue. `awaitingWebsiteCheck` cannot serve this: it keys on
   * `website_checked_at IS NULL`, and every lead is now stamped, so it selects
   * nothing forever. Improving the analyser would otherwise have no way to
   * reach the leads decided by the older, worse version of it.
   *
   * Three shapes qualify, all bounded by the timestamp:
   *   - UNREACHABLE — retry, now that several URL forms are tried
   *   - booking NONE — the inner-page crawl may find booking one click in
   *   - EXISTS + booking UNKNOWN — the old shape of a failed fetch, before
   *     UNREACHABLE was recordable. Matching it here means the 19,390 leads
   *     stuck in that state are reachable without a data migration, and they
   *     get labelled correctly as a side effect of being re-read.
   *
   * Leads with a booking answer are excluded: that question is settled, and
   * re-reading them would spend the budget re-confirming what we know.
   */
  needsWebsiteRecheck?: string;
  /**
   * The gate between the holding area and the working list.
   *
   * true  — finished being researched: booking answered, by the current
   *         method, not a duplicate. Safe to put in front of the owner.
   * false — still being worked on. Useful for showing what is held and why,
   *         never for building a call list.
   *
   * Takes the current version as a parameter rather than reading a constant
   * so a query cannot silently drift from whatever the code believes the
   * current method to be.
   */
  readyForReview?: { ready: boolean; analysisVersion: number };
  /** ISO timestamps bounding when the lead was discovered. A report over "yesterday" must not read the whole table to find yesterday. */
  discoveredSince?: string;
  discoveredBefore?: string;
  /** Case-insensitive substring of the business name, matched in SQL rather than by scanning every lead. */
  nameContains?: string;
  /** true for leads folded into another, false for leads standing on their own. Reporting counts them separately. */
  isDuplicate?: boolean;
  /**
   * Only leads that have completed a given pipeline stage.
   *
   * Matched with LIKE against the stored JSON array rather than by parsing it.
   * The stage names are distinct enough that a quoted substring cannot collide,
   * and it keeps the check in the database where the counting happens.
   */
  hasStage?: PipelineStageName;
}

/** Columns the dashboard groups by. A closed list because it is interpolated into SQL. */
export type LeadGroupColumn =
  | "city"
  | "state"
  | "industry"
  | "campaign_id"
  | "website_status"
  | "website_quality"
  | "online_booking_status"
  | "booking_provider"
  | "booking_method"
  | "data_confidence"
  | "qualification_status"
  | "research_status"
  // The raw JSON array. Only a handful of distinct values exist, so grouping on
  // it answers "how many reached each stage" in one pass instead of one
  // unindexable LIKE scan per stage.
  | "stages_completed";

export interface LeadGroupCount {
  value: string | null;
  count: number;
}

export interface LeadSummaryStats {
  total: number;
  scored: number;
  researched: number;
  qualified: number;
  highPriority: number;
  noWebsite: number;
  withPhone: number;
  bookingUnchecked: number;
  averageScore: number | null;
}

export interface JobsRepository {
  create(job: Job): Promise<Job>;
  update(job: Job): Promise<Job>;
  getById(id: string): Promise<Job | null>;
  list(filter?: { campaignId?: string; status?: JobStatus; city?: string; industry?: string }): Promise<Job[]>;
  claimNextPending(): Promise<Job | null>;
}

export interface CampaignsRepository {
  create(campaign: Campaign): Promise<Campaign>;
  update(campaign: Campaign): Promise<Campaign>;
  getById(id: string): Promise<Campaign | null>;
  list(): Promise<Campaign[]>;
}

export interface CrmRepository {
  upsert(record: CrmRecord): Promise<CrmRecord>;
  listByLead(leadId: string): Promise<CrmRecord[]>;
  list(): Promise<CrmRecord[]>;
  /**
   * Every lead id that has ever been synced, as one query.
   *
   * A bulk push has to skip what is already filed, and asking `listByLead`
   * per candidate would be one round trip per lead — eleven thousand of them
   * over a connection pooler. This returns only ids, so the result stays small
   * even when the CRM is full, and it grows with what has been *synced* rather
   * than with the size of the leads table.
   */
  syncedLeadIds(): Promise<string[]>;
}

export interface OutreachRepository {
  logAttempt(attempt: OutreachAttempt): Promise<OutreachAttempt>;
  list(): Promise<OutreachAttempt[]>;
}

export interface AgentActivityRepository {
  log(activity: AgentActivity): Promise<AgentActivity>;
  list(filter?: { agentId?: AgentId; campaignId?: string; leadId?: string; limit?: number }): Promise<AgentActivity[]>;
}

export interface HumanReviewRepository {
  create(item: HumanReviewItem): Promise<HumanReviewItem>;
  list(filter?: { status?: HumanReviewStatus; agentId?: AgentId }): Promise<HumanReviewItem[]>;
}

export interface ScoreResultsRepository {
  create(record: ScoreResultRecord): Promise<ScoreResultRecord>;
  listByLead(leadId: string): Promise<ScoreResultRecord[]>;
}

export interface Repositories {
  leads: LeadsRepository;
  jobs: JobsRepository;
  campaigns: CampaignsRepository;
  crm: CrmRepository;
  outreach: OutreachRepository;
  agentActivity: AgentActivityRepository;
  humanReview: HumanReviewRepository;
  scoreResults: ScoreResultsRepository;
  users: UsersRepository;
  passwordResets: PasswordResetRepository;
  // AI Manager storage — see manager/types.ts for the port definitions.
  conversations: ConversationsRepository;
  instructions: InstructionsRepository;
  managerActions: ManagerActionsRepository;
  reports: ReportsRepository;
  scheduledTasks: ScheduledTasksRepository;
  communications: CommunicationsRepository;
}
