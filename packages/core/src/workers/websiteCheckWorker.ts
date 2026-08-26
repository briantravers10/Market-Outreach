import type { Lead, PipelineStageName } from "../types";
import type { ScoringConfig } from "../config";
import type { ReasoningProvider } from "../reasoning/reasoningProvider";
import { fetchWithFallback, type SiteFetcher } from "../enrichment/siteFetcher";
import { analyzeSiteDeep } from "../enrichment/websiteAnalyzer";
import { scoreLead, qualificationStatusForScore } from "../scoring/scoringEngine";

/**
 * The Website Analyst, applied to one lead: fetch their site, read it, record
 * what it says, and re-score on the strength of the new evidence.
 *
 * Kept as a pure-ish function taking a fetcher rather than doing its own I/O,
 * so the whole judgement can be tested against canned pages. The only thing it
 * cannot decide for itself is whether the network cooperated.
 */

/**
 * How many leads a run should pull, given an optional override.
 *
 * Exists as a named function because getting it wrong cost a day of throughput:
 * `Number(searchParams.get("batch"))` on an absent parameter is `Number(null)`,
 * which is 0 — a perfectly finite number. `Number.isFinite` therefore said yes,
 * the clamp floored it to 1, and every scheduled run checked exactly one
 * website while reporting complete success. Absent and zero are different
 * things, and only an explicit positive number is an override.
 */
export function resolveBatchSize(raw: string | null, fallback: number, max: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const requested = Number(raw);
  if (!Number.isFinite(requested) || requested <= 0) return fallback;
  return Math.min(Math.floor(requested), max);
}

export interface WebsiteCheckResult {
  lead: Lead;
  /** What changed, in one line, for the activity log. */
  summary: string;
  reachable: boolean;
  /** Score before and after, so a run can report whether the work moved anything. */
  scoreBefore: number | null;
  scoreAfter: number | null;
}

function withStage(stages: PipelineStageName[], stage: PipelineStageName): PipelineStageName[] {
  return stages.includes(stage) ? stages : [...stages, stage];
}

export async function checkWebsite(
  lead: Lead,
  deps: {
    fetcher: SiteFetcher;
    scoringConfig: ScoringConfig;
    reasoning: ReasoningProvider;
    now: string;
    /** How many inner pages to try when the homepage shows no booking. */
    maxInnerPages?: number;
  }
): Promise<WebsiteCheckResult> {
  const scoreBefore = lead.prospectScore;

  if (!lead.website) {
    // Should not be selected in the first place; returning unchanged is safer
    // than inventing a finding for a business with nothing to read.
    return { lead, summary: "No website to read.", reachable: false, scoreBefore, scoreAfter: scoreBefore };
  }

  const { page, attempts } = await fetchWithFallback(deps.fetcher, lead.website);
  const analysis = await analyzeSiteDeep(
    page,
    (url) => deps.fetcher.fetchPage(url),
    {
      hasSocialProfile: Boolean(lead.instagram || lead.facebook),
      maxInnerPages: deps.maxInnerPages,
    }
  );

  const updated: Lead = {
    ...lead,
    // Stamped whether or not the fetch worked. A site that will not answer has
    // been checked; leaving this null would put it back in the queue forever.
    websiteCheckedAt: deps.now,
    dateLastResearched: deps.now,
  };

  if (analysis.unreachable) {
    // Say so on the lead itself.
    //
    // This used to write nothing but the timestamp, which left websiteStatus
    // reading EXISTS and booking reading UNKNOWN — identical to a lead nobody
    // had tried yet. Nineteen thousand leads ended up in that state, invisible
    // as a category and impossible to retry deliberately. A site we could not
    // reach is a finding, and a different sales conversation from one that
    // loads fine and has no booking button.
    updated.websiteStatus = "UNREACHABLE";
    // Deliberately NOT marked as website_analysis complete, and researchStatus
    // is left alone: nothing was read, so claiming the stage would put a tick
    // against work that did not happen. The lead is kept out of the queue by
    // websiteCheckedAt above, not by pretending it was analysed.
  } else {
    updated.websiteStatus = "EXISTS";
    updated.websiteQuality = analysis.websiteQuality;
    updated.onlineBookingStatus = analysis.onlineBookingStatus;
    updated.bookingProvider = analysis.bookingProvider;
    updated.bookingMethod = analysis.bookingMethod;
    updated.detectedLinks = analysis.detectedLinks;
    updated.stagesCompleted = withStage(updated.stagesCompleted, "website_analysis");
    updated.researchStatus = "ANALYZED";
  }

  // The evidence is appended rather than replaced: how we found them is still
  // true after we have read their site.
  updated.locationEvidence = [...lead.locationEvidence, ...analysis.evidence];

  const result = await scoreLead(updated, deps.scoringConfig, deps.reasoning);
  updated.prospectScore = result.score;
  updated.scoreBreakdown = result.breakdown;
  updated.scoreReason = result.scoreReason;
  updated.dataConfidence = result.confidence;
  updated.qualificationStatus = qualificationStatusForScore(result.score, deps.scoringConfig);
  updated.stagesCompleted = withStage(updated.stagesCompleted, "qualification");

  const summary = analysis.unreachable
    ? `${lead.businessName}: site did not respond after ${attempts.length} URL form${attempts.length === 1 ? "" : "s"} — ${analysis.evidence[0] ?? "no detail"}`
    : `${lead.businessName}: ${analysis.onlineBookingStatus === "NONE" ? "no online booking" : `books via ${analysis.bookingProvider ?? "an unrecognised tool"}`}, score ${scoreBefore ?? "?"} → ${result.score}`;

  return { lead: updated, summary, reachable: !analysis.unreachable, scoreBefore, scoreAfter: result.score };
}

/**
 * Runs a batch, with a cap on how many run at once.
 *
 * Concurrency is bounded for their sake as much as ours: a serverless function
 * opening two hundred simultaneous connections to small business websites is
 * indistinguishable from an attack, and several of these prospects are on
 * shared hosting that would fall over.
 */
export async function checkWebsites(
  leads: Lead[],
  deps: {
    fetcher: SiteFetcher;
    scoringConfig: ScoringConfig;
    reasoning: ReasoningProvider;
    now: string;
    concurrency?: number;
    /**
     * Stop starting new fetches after this many milliseconds.
     *
     * A serverless invocation has a hard timeout, and guessing a batch size
     * that fits it is guesswork that breaks the first time a run hits a
     * cluster of dead domains. A deadline is self-tuning: fast batches get
     * through hundreds, slow ones stop early and leave the rest queued.
     */
    deadlineMs?: number;
  }
): Promise<WebsiteCheckResult[]> {
  const concurrency = Math.max(1, Math.min(deps.concurrency ?? 6, 12));
  const startedAt = Date.now();
  const deadline = deps.deadlineMs ?? Infinity;
  const results: WebsiteCheckResult[] = [];
  let cursor = 0;

  async function drain(): Promise<void> {
    for (;;) {
      if (Date.now() - startedAt >= deadline) return;
      const index = cursor++;
      if (index >= leads.length) return;
      try {
        results.push(await checkWebsite(leads[index], deps));
      } catch (caught) {
        // One unparseable page must not abandon the rest of the batch.
        const message = caught instanceof Error ? caught.message : String(caught);
        results.push({
          lead: { ...leads[index], websiteCheckedAt: deps.now },
          summary: `${leads[index].businessName}: analysis failed — ${message}`,
          reachable: false,
          scoreBefore: leads[index].prospectScore,
          scoreAfter: leads[index].prospectScore,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, leads.length) }, drain));
  return results;
}
