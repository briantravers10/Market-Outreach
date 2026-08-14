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

  campaignId: string;
  jobId: string;
  isDuplicateOf: string | null;

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
  createdAt: string;
  updatedAt: string;
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

export interface Repositories {
  leads: LeadsRepository;
  jobs: JobsRepository;
  campaigns: CampaignsRepository;
  crm: CrmRepository;
  outreach: OutreachRepository;
}
