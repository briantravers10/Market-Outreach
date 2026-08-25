import "server-only";
import type {
  CountBreakdown,
  LeadFilter,
  LeadGroupColumn,
  LeadsRepository,
  ProgressBucket,
} from "@market-outreach/core";

/**
 * Dashboard aggregates, computed in the database.
 *
 * The reporting builders in core take `Lead[]` and reduce, which is exactly
 * right for a report over a period and exactly wrong for a page that renders
 * every few seconds. With seventy-seven thousand leads, Overview and Campaigns
 * were pulling the whole table on every poll and running the connection pool
 * dry — the symptom being "timeout exceeded when trying to connect" on pages
 * that had nothing to do with each other.
 *
 * These do the same arithmetic with GROUP BY, so a page costs a dozen rows
 * instead of the table. Core keeps the array versions because a generated
 * report genuinely does need the leads themselves.
 */

/**
 * A ProgressBucket per distinct value of a column.
 *
 * Three grouped queries rather than one, because the totals, the qualified
 * subset and the high-priority subset are different filters over the same
 * grouping — and three small round trips still beat one enormous one.
 */
export async function bucketsFor(
  leads: LeadsRepository,
  column: LeadGroupColumn,
  options: { labels?: Map<string, string>; limit?: number; filter?: LeadFilter } = {}
): Promise<ProgressBucket[]> {
  const base = options.filter ?? {};
  const [totals, qualified, highPriority] = await Promise.all([
    leads.groupCount(column, base),
    leads.groupCount(column, { ...base, qualificationStatus: "QUALIFIED" }),
    leads.groupCount(column, { ...base, qualificationStatus: "HIGH_PRIORITY" }),
  ]);

  const qualifiedBy = new Map(qualified.map((row) => [row.value ?? "", row.count]));
  const highPriorityBy = new Map(highPriority.map((row) => [row.value ?? "", row.count]));

  const buckets = totals.map((row) => {
    const key = row.value ?? "";
    const high = highPriorityBy.get(key) ?? 0;
    return {
      key,
      label: options.labels?.get(key) ?? key,
      totalLeads: row.count,
      // "Qualified" on these tiles has always meant qualified-or-better.
      qualifiedLeads: (qualifiedBy.get(key) ?? 0) + high,
      highPriorityLeads: high,
      // Deliberately omitted rather than faked: a per-bucket average would be
      // another query per row, and nothing on these tiles reads it.
      averageScore: null,
    } satisfies ProgressBucket;
  });

  return options.limit ? buckets.slice(0, options.limit) : buckets;
}

/** A CountBreakdown list — value, count, and share of the whole — from one grouped query. */
export async function breakdownFor(
  leads: LeadsRepository,
  column: LeadGroupColumn,
  options: { filter?: LeadFilter; limit?: number; skipNull?: boolean } = {}
): Promise<CountBreakdown[]> {
  const rows = await leads.groupCount(column, options.filter ?? {});
  const usable = options.skipNull ? rows.filter((row) => row.value !== null && row.value !== "") : rows;
  const total = usable.reduce((sum, row) => sum + row.count, 0);
  const breakdown = usable.map((row) => ({
    key: row.value ?? "—",
    count: row.count,
    pct: total === 0 ? 0 : Math.round((row.count / total) * 100),
  }));
  return options.limit ? breakdown.slice(0, options.limit) : breakdown;
}

/** Counts keyed by campaign id, for the per-campaign progress bars. */
export async function leadCountsByCampaign(
  leads: LeadsRepository
): Promise<{ total: Map<string, number>; qualified: Map<string, number> }> {
  const [total, qualified, highPriority] = await Promise.all([
    leads.groupCount("campaign_id"),
    leads.groupCount("campaign_id", { qualificationStatus: "QUALIFIED" }),
    leads.groupCount("campaign_id", { qualificationStatus: "HIGH_PRIORITY" }),
  ]);
  const qualifiedMap = new Map<string, number>();
  for (const row of [...qualified, ...highPriority]) {
    const key = row.value ?? "";
    qualifiedMap.set(key, (qualifiedMap.get(key) ?? 0) + row.count);
  }
  return {
    total: new Map(total.map((row) => [row.value ?? "", row.count])),
    qualified: qualifiedMap,
  };
}

/**
 * How many leads have reached each pipeline stage.
 *
 * One grouped query over the stored JSON, rather than a LIKE scan per stage.
 * `stages_completed` only ever holds a handful of distinct arrays, so grouping
 * on the raw text and unpacking the groups here is exact and costs one pass.
 */
export async function stageCounts(leads: LeadsRepository): Promise<Map<string, number>> {
  const groups = await leads.groupCount("stages_completed");
  const counts = new Map<string, number>();
  for (const group of groups) {
    let stages: string[];
    try {
      stages = JSON.parse(group.value ?? "[]") as string[];
    } catch {
      continue;
    }
    for (const stage of stages) {
      counts.set(stage, (counts.get(stage) ?? 0) + group.count);
    }
  }
  return counts;
}
