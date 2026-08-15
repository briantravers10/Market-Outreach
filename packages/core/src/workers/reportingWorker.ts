import type { AgentActivity, AgentId, Campaign, Job, Lead } from "../types";

export interface OverallSummary {
  businessesDiscovered: number;
  businessesResearched: number;
  qualifiedLeads: number;
  highPriorityLeads: number;
  averageProspectScore: number | null;
  jobsPending: number;
  jobsRunning: number;
  jobsFailedOrRetry: number;
  jobsHumanReview: number;
}

export interface ProgressBucket {
  key: string;
  label: string;
  totalLeads: number;
  qualifiedLeads: number;
  highPriorityLeads: number;
  averageScore: number | null;
}

function average(scores: number[]): number | null {
  if (!scores.length) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

/** Reporting Worker — deterministic aggregation over leads/jobs for the dashboard. */
export function buildOverallSummary(leads: Lead[], jobs: Job[]): OverallSummary {
  const researched = leads.filter((l) => l.researchStatus !== "NOT_STARTED" && l.researchStatus !== "DISCOVERED");
  const qualified = leads.filter((l) => l.qualificationStatus === "QUALIFIED" || l.qualificationStatus === "HIGH_PRIORITY");
  const highPriority = leads.filter((l) => l.qualificationStatus === "HIGH_PRIORITY");
  const scored = leads.filter((l) => l.prospectScore !== null).map((l) => l.prospectScore as number);

  return {
    businessesDiscovered: leads.length,
    businessesResearched: researched.length,
    qualifiedLeads: qualified.length,
    highPriorityLeads: highPriority.length,
    averageProspectScore: average(scored),
    jobsPending: jobs.filter((j) => j.status === "pending").length,
    jobsRunning: jobs.filter((j) => j.status === "running").length,
    jobsFailedOrRetry: jobs.filter((j) => j.status === "failed" || j.status === "retry").length,
    jobsHumanReview: jobs.filter((j) => j.status === "human_review").length,
  };
}

export function buildProgressByCity(leads: Lead[]): ProgressBucket[] {
  return bucketBy(leads, (l) => l.city);
}

export function buildProgressByIndustry(leads: Lead[]): ProgressBucket[] {
  return bucketBy(leads, (l) => l.industry);
}

function bucketBy(leads: Lead[], keyFn: (lead: Lead) => string): ProgressBucket[] {
  const map = new Map<string, Lead[]>();
  for (const lead of leads) {
    const key = keyFn(lead);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(lead);
  }
  return Array.from(map.entries())
    .map(([key, group]) => ({
      key,
      label: key,
      totalLeads: group.length,
      qualifiedLeads: group.filter((l) => l.qualificationStatus === "QUALIFIED" || l.qualificationStatus === "HIGH_PRIORITY").length,
      highPriorityLeads: group.filter((l) => l.qualificationStatus === "HIGH_PRIORITY").length,
      averageScore: average(group.filter((l) => l.prospectScore !== null).map((l) => l.prospectScore as number)),
    }))
    .sort((a, b) => b.totalLeads - a.totalLeads);
}

export interface CountBreakdown {
  key: string;
  count: number;
  pct: number;
}

/** Generic "how many leads fall into each bucket" breakdown, sorted largest first. */
export function buildBreakdown(items: Lead[], keyFn: (lead: Lead) => string): CountBreakdown[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  const total = items.length || 1;
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

export function buildWebsiteStatusBreakdown(leads: Lead[]): CountBreakdown[] {
  return buildBreakdown(leads, (l) => (l.websiteStatus === "NONE" ? "No website" : l.websiteQuality));
}

export function buildBookingStatusBreakdown(leads: Lead[]): CountBreakdown[] {
  return buildBreakdown(leads, (l) => l.bookingMethod.replace(/_/g, " "));
}

export function buildBookingProviderBreakdown(leads: Lead[]): CountBreakdown[] {
  return buildBreakdown(
    leads.filter((l) => l.bookingProvider),
    (l) => l.bookingProvider as string
  );
}

export function buildConfidenceBreakdown(leads: Lead[]): CountBreakdown[] {
  return buildBreakdown(leads, (l) => l.dataConfidence);
}

export interface AgentThroughput {
  agentId: AgentId;
  actionCount: number;
  errorCount: number;
  humanReviewCount: number;
}

export function buildAgentThroughput(activity: AgentActivity[]): AgentThroughput[] {
  const map = new Map<AgentId, AgentThroughput>();
  for (const a of activity) {
    if (!map.has(a.agentId)) map.set(a.agentId, { agentId: a.agentId, actionCount: 0, errorCount: 0, humanReviewCount: 0 });
    const entry = map.get(a.agentId)!;
    entry.actionCount += 1;
    if (a.level === "error") entry.errorCount += 1;
    if (a.level === "human_review") entry.humanReviewCount += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.actionCount - a.actionCount);
}

export function buildCampaignProgress(campaign: Campaign, jobs: Job[], leads: Lead[]) {
  const campaignJobs = jobs.filter((j) => j.campaignId === campaign.id);
  const campaignLeads = leads.filter((l) => l.campaignId === campaign.id);
  const completeJobs = campaignJobs.filter((j) => j.status === "complete").length;

  return {
    campaignId: campaign.id,
    totalJobs: campaignJobs.length,
    pendingJobs: campaignJobs.filter((j) => j.status === "pending").length,
    runningJobs: campaignJobs.filter((j) => j.status === "running").length,
    completeJobs,
    failedJobs: campaignJobs.filter((j) => j.status === "failed" || j.status === "retry").length,
    leadsDiscovered: campaignLeads.length,
    leadsQualified: campaignLeads.filter((l) => l.qualificationStatus === "QUALIFIED" || l.qualificationStatus === "HIGH_PRIORITY").length,
    completionPct: campaignJobs.length === 0 ? 0 : Math.round((completeJobs / campaignJobs.length) * 100),
  };
}
