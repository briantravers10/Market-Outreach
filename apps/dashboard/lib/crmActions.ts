"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  bulkPushToCrm,
  describeBulkPush,
  PipedriveCrmAdapter,
  type BulkPushResult,
  type QualificationStatus,
} from "@market-outreach/core";
import { getRepos } from "./data";
import { isDemoMode } from "./demo";

/**
 * Bulk CRM push, driven from the CRM page.
 *
 * Two safety properties are enforced HERE rather than left to the UI, because
 * a form is only a suggestion — anything can post to a server action:
 *
 *   - Preview is the default. A real push happens only when the form
 *     explicitly says `confirm=push`. A missing or misspelt field previews.
 *   - The batch size is clamped. A hand-edited form cannot ask this to file
 *     eleven thousand organizations into a real CRM in one request.
 */

const MAX_BATCH = 500;
const DEFAULT_BATCH = 100;

/** Bounds the batch, and survives the `Number(null) === 0` trap on a missing field. */
export async function resolveBatch(raw: FormDataEntryValue | null): Promise<number> {
  const parsed = Number.parseInt(typeof raw === "string" ? raw : "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH;
  return Math.min(parsed, MAX_BATCH);
}

function statusesFrom(form: FormData): QualificationStatus[] | undefined {
  const chosen = form.getAll("status").filter((v): v is string => typeof v === "string");
  if (chosen.length === 0) return undefined;
  // Only the two the pipeline itself pushes are accepted. Anything else in the
  // form is ignored rather than trusted — this is the field that decides who
  // ends up in a real CRM.
  const allowed = new Set<QualificationStatus>(["QUALIFIED", "HIGH_PRIORITY"]);
  const valid = chosen.filter((s): s is QualificationStatus => allowed.has(s as QualificationStatus));
  return valid.length > 0 ? valid : undefined;
}

export async function bulkPushAction(form: FormData): Promise<void> {
  if (isDemoMode) return;

  const repos = getRepos();
  const adapter = new PipedriveCrmAdapter(repos.crm);

  const state = typeof form.get("state") === "string" ? (form.get("state") as string).trim() : "";
  const minScoreRaw = Number.parseInt(String(form.get("minScore") ?? ""), 10);

  const result = await bulkPushToCrm(
    { leads: repos.leads, crm: repos.crm, adapter },
    {
      limit: await resolveBatch(form.get("batch")),
      // Anything other than the exact confirmation string is a preview.
      dryRun: form.get("confirm") !== "push",
      filter: {
        statuses: statusesFrom(form),
        minScore: Number.isFinite(minScoreRaw) && minScoreRaw > 0 ? minScoreRaw : undefined,
        state: state || undefined,
      },
    }
  );

  revalidatePath("/crm");
  revalidatePath("/leads");
  revalidatePath("/overview");

  redirect(`/crm?${new URLSearchParams({ result: encodeResult(result) }).toString()}`);
}

/**
 * The result travels back through the URL because a server action cannot
 * return a value to a page render. Kept to counts and a short sample so the
 * URL stays a sane length on a run covering thousands of leads.
 */
function encodeResult(result: BulkPushResult): string {
  return JSON.stringify({
    d: result.dryRun,
    e: result.eligible,
    a: result.alreadySynced,
    p: result.pushed,
    r: result.remaining,
    f: result.failures.slice(0, 5).map((f) => [f.businessName, f.error] as const),
    fn: result.failures.length,
    s: describeBulkPush(result),
    pv: result.preview.slice(0, 10).map((row) => [row.businessName, row.city, row.score, row.objects.length] as const),
  });
}

export interface DecodedPushResult {
  dryRun: boolean;
  eligible: number;
  alreadySynced: number;
  pushed: number;
  remaining: number;
  failures: [string, string][];
  failureCount: number;
  summary: string;
  preview: [string, string, number | null, number][];
}

export async function decodePushResult(raw: string | undefined): Promise<DecodedPushResult | null> {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      dryRun: parsed.d === true,
      eligible: Number(parsed.e) || 0,
      alreadySynced: Number(parsed.a) || 0,
      pushed: Number(parsed.p) || 0,
      remaining: Number(parsed.r) || 0,
      failures: (parsed.f as [string, string][]) ?? [],
      failureCount: Number(parsed.fn) || 0,
      summary: typeof parsed.s === "string" ? parsed.s : "",
      preview: (parsed.pv as [string, string, number | null, number][]) ?? [],
    };
  } catch {
    // A mangled or hand-edited URL should show no banner, not crash the page.
    return null;
  }
}
