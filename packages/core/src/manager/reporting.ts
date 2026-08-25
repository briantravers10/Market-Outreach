import { randomUUID } from "node:crypto";
import type { Lead, Repositories } from "../types";
import type { Period } from "./periods";
import { previousPeriodOf, withinPeriod } from "./periods";
import type { PeriodComparison, Report, ReportMetrics, ReportType } from "./types";

/**
 * Report generation.
 *
 * Every number here is counted from rows that exist. Nothing is estimated,
 * extrapolated, or carried forward from a previous report — if the period was
 * quiet, the report says the period was quiet.
 *
 * The summary is assembled from those same counted numbers by
 * `writeSummary`, so the prose can never disagree with the metrics block
 * beneath it. When an LLM is configured it may *rephrase* a summary, but the
 * figures it is given are these.
 */

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Leads whose discovery timestamp falls in the period. */
function leadsIn(leads: Lead[], period: Period): Lead[] {
  return leads.filter((l) => withinPeriod(l.dateDiscovered, period));
}

function averageScore(leads: Lead[]): number | null {
  const scored = leads.filter((l) => l.prospectScore !== null);
  if (scored.length === 0) return null;
  const total = scored.reduce((sum, l) => sum + (l.prospectScore ?? 0), 0);
  return Math.round((total / scored.length) * 10) / 10;
}

function comparisonFor(leads: Lead[], period: Period): PeriodComparison {
  const inPeriod = leadsIn(leads, period);
  return {
    periodStart: period.start,
    periodEnd: period.end,
    businessesDiscovered: inPeriod.length,
    qualifiedLeads: inPeriod.filter((l) => l.qualificationStatus === "QUALIFIED" || l.qualificationStatus === "HIGH_PRIORITY").length,
    highPriorityLeads: inPeriod.filter((l) => l.qualificationStatus === "HIGH_PRIORITY").length,
    averageScore: averageScore(inPeriod),
  };
}

/**
 * Counts everything that happened in a period.
 *
 * `includeComparison` is off for the comparison pass itself, so a report never
 * recurses into comparing the comparison.
 */
export async function computeMetrics(
  repos: Repositories,
  period: Period,
  opts: { includeComparison?: boolean } = {}
): Promise<ReportMetrics> {
  const [leads, jobs, activity, humanReview, instructions] = await Promise.all([
    repos.leads.list(),
    repos.jobs.list(),
    repos.agentActivity.list({ limit: 5000 }),
    repos.humanReview.list({ status: "open" }),
    repos.instructions.list({ since: period.start, limit: 500 }),
  ]);

  const periodLeads = leadsIn(leads, period);
  const periodActivity = activity.filter((a) => withinPeriod(a.createdAt, period));
  // Jobs are counted by when they last changed state, which is the only
  // timestamp that tracks completion — created_at would count work that was
  // queued in the period but finished outside it.
  const periodJobs = jobs.filter((j) => withinPeriod(j.updatedAt, period));

  const agentIds = Array.from(new Set(periodActivity.map((a) => a.agentId)));
  const agentActivityCounts = agentIds
    .map((agentId) => ({
      agentId,
      actions: periodActivity.filter((a) => a.agentId === agentId).length,
      errors: periodActivity.filter((a) => a.agentId === agentId && a.level === "error").length,
    }))
    .sort((a, b) => b.actions - a.actions);

  const topLeads = [...periodLeads]
    .filter((l) => l.prospectScore !== null && l.qualificationStatus !== "DISQUALIFIED")
    .sort((a, b) => (b.prospectScore ?? 0) - (a.prospectScore ?? 0))
    .slice(0, 5)
    .map((l) => ({ id: l.id, businessName: l.businessName, city: l.city, score: l.prospectScore }));

  return {
    businessesDiscovered: periodLeads.length,
    businessesResearched: periodLeads.filter((l) => l.researchStatus === "COMPLETE" || l.researchStatus === "ANALYZED").length,
    businessesAnalyzed: periodLeads.filter((l) => l.stagesCompleted.includes("website_analysis")).length,
    qualifiedLeads: periodLeads.filter((l) => l.qualificationStatus === "QUALIFIED" || l.qualificationStatus === "HIGH_PRIORITY").length,
    highPriorityLeads: periodLeads.filter((l) => l.qualificationStatus === "HIGH_PRIORITY").length,
    rejectedLeads: periodLeads.filter((l) => l.qualificationStatus === "DISQUALIFIED" && !l.isDuplicateOf).length,
    duplicatesRemoved: periodLeads.filter((l) => l.isDuplicateOf !== null).length,
    jobsCompleted: periodJobs.filter((j) => j.status === "complete").length,
    jobsFailed: periodJobs.filter((j) => j.status === "failed" || j.status === "retry").length,
    openHumanReviewItems: humanReview.length,
    averageScore: averageScore(periodLeads),
    topLeads,
    agentActivityCounts,
    instructionsChanged: instructions.filter((i) => withinPeriod(i.createdAt, period)).length,
    previousPeriod: opts.includeComparison === false ? null : comparisonFor(leads, previousPeriodOf(period)),
  };
}

// ---------------------------------------------------------------------------
// Summary prose
// ---------------------------------------------------------------------------

function delta(current: number, previous: number): string {
  const diff = current - previous;
  if (diff === 0) return "level with the period before";
  const direction = diff > 0 ? "up" : "down";
  return `${direction} ${Math.abs(diff)} on the period before`;
}

/**
 * Writes the report text from the counted metrics.
 *
 * Deliberately plain and structured rather than chatty: this gets read at 9am
 * and skimmed. Anything it claims is traceable to a field in `metrics`.
 */
export function writeSummary(metrics: ReportMetrics, period: Period, type: ReportType): string {
  const lines: string[] = [];
  const prev = metrics.previousPeriod;

  if (metrics.businessesDiscovered === 0 && metrics.jobsCompleted === 0) {
    lines.push(`Nothing ran in ${period.label}. No businesses were discovered and no jobs completed.`);
    if (metrics.openHumanReviewItems > 0) {
      lines.push(`${metrics.openHumanReviewItems} item${metrics.openHumanReviewItems === 1 ? "" : "s"} still need${metrics.openHumanReviewItems === 1 ? "s" : ""} your attention from earlier.`);
    }
    return lines.join("\n");
  }

  lines.push(
    `The Scout discovered ${metrics.businessesDiscovered} business${metrics.businessesDiscovered === 1 ? "" : "es"} in ${period.label}` +
      (prev ? `, ${delta(metrics.businessesDiscovered, prev.businessesDiscovered)}.` : ".")
  );

  lines.push(
    `${metrics.qualifiedLeads} passed qualification, of which ${metrics.highPriorityLeads} ` +
      `${metrics.highPriorityLeads === 1 ? "is" : "are"} high priority` +
      (prev ? ` (${delta(metrics.highPriorityLeads, prev.highPriorityLeads)}).` : ".")
  );

  if (metrics.rejectedLeads > 0 || metrics.duplicatesRemoved > 0) {
    lines.push(
      `${metrics.rejectedLeads} were rejected and ${metrics.duplicatesRemoved} removed as duplicates.`
    );
  }

  if (metrics.averageScore !== null) {
    const change =
      prev?.averageScore != null
        ? ` (was ${prev.averageScore} the period before)`
        : "";
    lines.push(`Average prospect score was ${metrics.averageScore}${change}.`);
  }

  if (metrics.topLeads.length > 0) {
    const best = metrics.topLeads[0];
    lines.push(`Strongest opportunity: ${best.businessName} in ${best.city}, scoring ${best.score}.`);
  }

  if (metrics.jobsFailed > 0) {
    lines.push(`${metrics.jobsFailed} job${metrics.jobsFailed === 1 ? "" : "s"} failed or need retrying.`);
  }
  if (metrics.openHumanReviewItems > 0) {
    lines.push(`${metrics.openHumanReviewItems} item${metrics.openHumanReviewItems === 1 ? "" : "s"} flagged for your attention.`);
  }
  if (metrics.instructionsChanged > 0) {
    lines.push(`You changed ${metrics.instructionsChanged} employee instruction${metrics.instructionsChanged === 1 ? "" : "s"} in this period.`);
  }

  if (type === "weekly" && metrics.agentActivityCounts.length > 0) {
    const busiest = metrics.agentActivityCounts[0];
    lines.push(`Busiest employee was the ${busiest.agentId} with ${busiest.actions} recorded actions.`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Generation + archiving
// ---------------------------------------------------------------------------

const TITLES: Record<ReportType, string> = {
  daily: "Daily report",
  weekly: "Weekly report",
  briefing: "Briefing",
  custom: "Report",
};

/**
 * Computes, writes and archives a report in one step.
 *
 * Always persisted — a report the owner asked for and can't find again later is
 * a report that may as well not have been generated.
 */
export async function generateReport(
  repos: Repositories,
  opts: {
    type: ReportType;
    period: Period;
    generatedBy?: string;
    scheduledTaskId?: string | null;
    now?: Date;
  }
): Promise<Report> {
  const metrics = await computeMetrics(repos, opts.period);
  const summary = writeSummary(metrics, opts.period, opts.type);
  const now = opts.now ?? new Date();

  const report: Report = {
    id: randomUUID(),
    type: opts.type,
    title: `${TITLES[opts.type]} — ${opts.period.label}`,
    periodStart: opts.period.start,
    periodEnd: opts.period.end,
    metrics,
    summary,
    generatedBy: opts.generatedBy ?? "manager",
    scheduledTaskId: opts.scheduledTaskId ?? null,
    generatedAt: now.toISOString(),
  };

  await repos.reports.create(report);
  return report;
}
