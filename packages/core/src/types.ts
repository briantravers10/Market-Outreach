/**
 * Canonical domain types for the prospecting system.
 * Pure types only — this file has zero runtime dependencies, so both
 * @market-outreach/db (storage) and apps/dashboard (UI) can depend on it
 * without creating a cycle. Repositories are expressed as *interfaces*
 * here (ports); @market-outreach/db provides the SQLite implementations
 * (adapters), which callers (scripts, dashboard) inject into workers.
 */

// ---------------------------------------------------------------------------
// Enums (string unions so they read cleanly in JSON/SQLite and in the UI)
// ---------------------------------------------------------------------------

import type { DetectedLink } from "./enrichment/linkClassifier";

export type WebsiteStatus = "NONE" | "EXISTS";
export type WebsiteQuality = "POOR" | "AVERAGE" | "GOOD" | "EXCELLENT" | "UNKNOWN";

/** What booking capability exists, if any. */
export type OnlineBookingStatus = "NONE" | "THIRD_PARTY_BOOKING_SYSTEM" | "INTEGRATED_BOOKING_SYSTEM";

/** How a customer actually books, spanning both online and offline. */
export type BookingMethod = "NONE" | "PHONE_ONLY" | "SOCIAL_DM" | "ONLINE_THIRD_PARTY" | "ONLINE_INTEGRATED";

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
  externalCrmName: string; // e.g. "mock-crm" now, "hubspot" / "gohighlevel" later
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
  upsert(lead: Lead): Lead;
  getById(id: string): Lead | null;
  list(filter?: LeadFilter): Lead[];
  findPossibleDuplicates(lead: Pick<Lead, "businessName" | "address" | "phone" | "city">): Lead[];
}

export interface LeadFilter {
  city?: string;
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
}

export interface JobsRepository {
  create(job: Job): Job;
  update(job: Job): Job;
  getById(id: string): Job | null;
  list(filter?: { campaignId?: string; status?: JobStatus; city?: string; industry?: string }): Job[];
  claimNextPending(): Job | null;
}

export interface CampaignsRepository {
  create(campaign: Campaign): Campaign;
  update(campaign: Campaign): Campaign;
  getById(id: string): Campaign | null;
  list(): Campaign[];
}

export interface CrmRepository {
  upsert(record: CrmRecord): CrmRecord;
  listByLead(leadId: string): CrmRecord[];
  list(): CrmRecord[];
}

export interface OutreachRepository {
  logAttempt(attempt: OutreachAttempt): OutreachAttempt;
  list(): OutreachAttempt[];
}

export interface AgentActivityRepository {
  log(activity: AgentActivity): AgentActivity;
  list(filter?: { agentId?: AgentId; campaignId?: string; leadId?: string; limit?: number }): AgentActivity[];
}

export interface HumanReviewRepository {
  create(item: HumanReviewItem): HumanReviewItem;
  list(filter?: { status?: HumanReviewStatus; agentId?: AgentId }): HumanReviewItem[];
}

export interface ScoreResultsRepository {
  create(record: ScoreResultRecord): ScoreResultRecord;
  listByLead(leadId: string): ScoreResultRecord[];
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
}
