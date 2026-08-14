import type { Campaign, Job, Lead } from "../types";

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
