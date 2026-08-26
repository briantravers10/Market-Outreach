import type { Lead, LeadsRepository, CrmRepository, QualificationStatus } from "../types";
import type { CrmAdapter } from "./crmAdapter";
import { buildHandoff } from "./pipedriveAdapter";

/**
 * Filing the existing lead table into the CRM.
 *
 * The pipeline pushes a lead the moment it qualifies, which covers everything
 * discovered by running a campaign. It does not cover leads that arrived any
 * other way — and the bulk Overture import brought in seventy-seven thousand
 * of them, eleven thousand already qualified, none of which the pipeline ever
 * saw. Without this they would sit in the dashboard forever while the CRM
 * stayed empty.
 *
 * Three properties this has to have, in order of how much they cost if missing:
 *
 *   1. It must never double-file. Leads already in the CRM are excluded by id,
 *      resolved in a single query rather than one lookup per candidate.
 *   2. It must be previewable. Pushing eleven thousand organizations into
 *      somebody's real CRM is not an action to discover the shape of
 *      afterwards, so a dry run is the default and reports exactly what a real
 *      run would create.
 *   3. It must be resumable and bounded. A run is capped, reports what it did
 *      not reach, and running it again continues from where it stopped —
 *      because a network failure eight thousand records in must not mean
 *      starting over.
 */

export interface BulkPushFilter {
  /** Which leads are eligible. Defaults to the two statuses the pipeline itself pushes. */
  statuses?: QualificationStatus[];
  minScore?: number;
  state?: string;
  city?: string;
  industry?: string;
}

export interface BulkPushOptions {
  filter?: BulkPushFilter;
  /**
   * Hard ceiling on how many leads this run will push.
   *
   * Required rather than defaulted to "everything": the caller should have to
   * decide how much of a real CRM to fill in one go.
   */
  limit: number;
  /** False actually writes. Defaults to true, so forgetting the flag previews. */
  dryRun?: boolean;
  /** Called after each lead, for progress on a long run. */
  onProgress?: (done: number, total: number) => void;
}

export interface BulkPushPreviewRow {
  leadId: string;
  businessName: string;
  city: string;
  state: string | null;
  /** Null when the lead was never scored — shown as such rather than as a zero. */
  score: number | null;
  qualificationStatus: QualificationStatus;
  /** What would be created in the CRM: organization, person, deal. */
  objects: string[];
  /** Custom fields that would be omitted because the account has no key for them. */
  skippedFields: string[];
}

export interface BulkPushResult {
  dryRun: boolean;
  /** Eligible leads not yet in the CRM, before the limit was applied. */
  eligible: number;
  /** Eligible leads already filed, so skipped. */
  alreadySynced: number;
  /** Leads this run actually handled. */
  pushed: number;
  /** Eligible-but-not-reached because the limit was hit. Run again to continue. */
  remaining: number;
  failures: { leadId: string; businessName: string; error: string }[];
  /** A sample of what would be created. Bounded — this is for eyeballing, not auditing. */
  preview: BulkPushPreviewRow[];
}

export interface BulkPushDeps {
  leads: LeadsRepository;
  crm: CrmRepository;
  adapter: CrmAdapter;
}

const DEFAULT_STATUSES: QualificationStatus[] = ["QUALIFIED", "HIGH_PRIORITY"];
const PREVIEW_ROWS = 25;

function describeObjects(lead: Lead): { objects: string[]; skippedFields: string[] } {
  const handoff = buildHandoff(lead);
  // `skipped` hangs off each payload, and the same field can be skipped on
  // more than one object, so flatten and dedupe by label.
  const skipped = new Set<string>();
  for (const payload of handoff.payloads) {
    for (const field of payload.skipped) skipped.add(field.label);
  }
  return {
    objects: handoff.payloads.map((p) => p.object),
    skippedFields: [...skipped],
  };
}

/**
 * Selects, previews and (optionally) pushes.
 *
 * Note the candidate query asks for one status at a time. The filter takes a
 * list, and the repository takes a single value — fetching everything and
 * filtering in memory would mean pulling seventy-seven thousand rows to find
 * eleven thousand, so it issues one bounded query per status instead.
 */
export async function bulkPushToCrm(
  deps: BulkPushDeps,
  options: BulkPushOptions
): Promise<BulkPushResult> {
  const dryRun = options.dryRun ?? true;
  const statuses = options.filter?.statuses?.length ? options.filter.statuses : DEFAULT_STATUSES;

  if (options.limit <= 0) {
    return { dryRun, eligible: 0, alreadySynced: 0, pushed: 0, remaining: 0, failures: [], preview: [] };
  }

  const synced = new Set(await deps.crm.syncedLeadIds());

  // Over-fetch relative to the limit so that leads filtered out for being
  // already synced do not eat into how many actually get pushed. Bounded, so a
  // CRM that is already mostly full still can't turn this into a full scan.
  const fetchCeiling = Math.min(options.limit * 4 + 200, 20_000);

  const candidates: Lead[] = [];
  const seen = new Set<string>();
  for (const status of statuses) {
    const rows = await deps.leads.list({
      qualificationStatus: status,
      minScore: options.filter?.minScore,
      state: options.filter?.state,
      city: options.filter?.city,
      industry: options.filter?.industry,
      isDuplicate: false,
      orderBy: "score",
      limit: fetchCeiling,
    });
    for (const lead of rows) {
      // A lead could match two status queries only if the data changed
      // underneath us, but deduping here is cheaper than reasoning about it.
      if (seen.has(lead.id)) continue;
      seen.add(lead.id);
      candidates.push(lead);
    }
  }

  const alreadySynced = candidates.filter((lead) => synced.has(lead.id)).length;
  const pending = candidates.filter((lead) => !synced.has(lead.id));

  // Best-scoring first, so a capped run fills the CRM with the leads worth
  // calling rather than an arbitrary slice. An unscored lead sorts last rather
  // than as a zero — it is "not yet known", not "known to be worthless", and
  // sorting it among genuine zeroes would bury it.
  pending.sort((a, b) => (b.prospectScore ?? -1) - (a.prospectScore ?? -1));

  const batch = pending.slice(0, options.limit);
  const preview: BulkPushPreviewRow[] = batch.slice(0, PREVIEW_ROWS).map((lead) => {
    const { objects, skippedFields } = describeObjects(lead);
    return {
      leadId: lead.id,
      businessName: lead.businessName,
      city: lead.city,
      state: lead.state ?? null,
      score: lead.prospectScore,
      qualificationStatus: lead.qualificationStatus,
      objects,
      skippedFields,
    };
  });

  const failures: BulkPushResult["failures"] = [];
  let pushed = 0;

  if (!dryRun) {
    for (const lead of batch) {
      try {
        await deps.adapter.pushLead(lead);
        pushed += 1;
      } catch (err) {
        // One bad record must not abandon the other ten thousand. It is
        // recorded and the run continues; because pushing is keyed on lead id,
        // re-running picks the failure back up with nothing duplicated.
        failures.push({
          leadId: lead.id,
          businessName: lead.businessName,
          error: (err as Error).message,
        });
      }
      options.onProgress?.(pushed + failures.length, batch.length);
    }
  }

  return {
    dryRun,
    eligible: pending.length,
    alreadySynced,
    pushed: dryRun ? 0 : pushed,
    remaining: Math.max(0, pending.length - batch.length),
    failures,
    preview,
  };
}

/** One-line summary, used by the dashboard and by the Manager when asked. */
export function describeBulkPush(result: BulkPushResult): string {
  if (result.eligible === 0) {
    return result.alreadySynced > 0
      ? `Nothing to push — all ${result.alreadySynced.toLocaleString()} matching leads are already in the CRM.`
      : "No leads match that filter.";
  }
  if (result.dryRun) {
    return (
      `${result.eligible.toLocaleString()} lead${result.eligible === 1 ? "" : "s"} would be pushed` +
      (result.remaining > 0 ? `, ${(result.eligible - result.remaining).toLocaleString()} in this run` : "") +
      (result.alreadySynced > 0 ? `. ${result.alreadySynced.toLocaleString()} already filed and skipped.` : ".")
    );
  }
  const parts = [`Pushed ${result.pushed.toLocaleString()}.`];
  if (result.failures.length > 0) parts.push(`${result.failures.length} failed.`);
  if (result.remaining > 0) parts.push(`${result.remaining.toLocaleString()} still to go — run it again to continue.`);
  return parts.join(" ");
}
