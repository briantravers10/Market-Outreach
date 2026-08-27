import type { Lead } from "../types";
import type { ScoringConfig } from "../config";
import type { ReasoningProvider } from "../reasoning/reasoningProvider";
import type { DirectoryPlatform, MatchOptions } from "../enrichment/bookingDirectory";
import {
  coverageKey,
  lookupInIndex,
  type DirectoryCrawl,
  type DirectoryIndexRepository,
} from "../enrichment/directoryIndex";
import { scoreLead, qualificationStatusForScore } from "../scoring/scoringEngine";
import { ANALYSIS_VERSION } from "../scoring/readiness";

/**
 * Settles the booking question for one business from the town directories
 * already read, without touching the network.
 *
 * The rule that everything else here exists to serve: a NONE may only be
 * recorded when EVERY enabled platform has a completed directory for this
 * business's town and trade. One missing index and the answer stays UNKNOWN.
 *
 * That is the difference between "we looked everywhere and they book by phone"
 * — the most valuable thing this system can know about a business — and "we
 * did not manage to look", which is worth nothing and, recorded as the former,
 * is worth less than nothing: it hands out the largest positive factor in the
 * scoring model and the owner discovers the error by ringing someone who
 * already has an incumbent.
 */

export interface DirectoryMatchResult {
  lead: Lead;
  summary: string;
  /** True when the booking question is now settled either way. */
  resolved: boolean;
  /** Towns-and-trades not yet readable, per platform, for the activity log. */
  missingIndexes: { platform: string; reason: string }[];
  scoreBefore: number | null;
  scoreAfter: number | null;
}

export interface DirectoryMatchDeps {
  platforms: DirectoryPlatform[];
  index: DirectoryIndexRepository;
  match: MatchOptions;
  scoringConfig: ScoringConfig;
  reasoning: ReasoningProvider;
  now: string;
  /**
   * Crawl records for this lead's town, if the caller already has them.
   *
   * A batch normally shares one town, and re-reading the same handful of crawl
   * rows once per lead turns a hundred and twenty leads into hundreds of
   * pointless queries.
   */
  crawls?: DirectoryCrawl[];
}

export async function matchAgainstDirectories(
  lead: Lead,
  deps: DirectoryMatchDeps
): Promise<DirectoryMatchResult> {
  const scoreBefore = lead.prospectScore;
  const enabled = deps.platforms.filter((p) => p.enabled);

  const crawls =
    deps.crawls ??
    (await deps.index.crawlsFor({ city: lead.city, state: lead.state, industry: lead.industry }));
  const crawlById = new Map(crawls.map((c) => [c.id, c]));

  const missingIndexes: { platform: string; reason: string }[] = [];
  const checked: string[] = [];
  let listedOn: { platform: DirectoryPlatform; profileUrl: string; matchedName: string } | null = null;

  for (const platform of enabled) {
    const scope = { platform: platform.id, city: lead.city, state: lead.state, industry: lead.industry };
    const crawl = crawlById.get(coverageKey(scope)) ?? null;

    // Only fetched when there is a completed index to search. A town nobody
    // has read has nothing to load.
    const listings =
      crawl?.status === "complete" ? await deps.index.listingsFor(scope) : [];

    const verdict = lookupInIndex(lead, platform, crawl, listings, deps.match);

    if (verdict.kind === "listed") {
      listedOn = { platform, profileUrl: verdict.profileUrl, matchedName: verdict.matchedName };
      break;
    }
    if (verdict.kind === "not-listed") {
      checked.push(platform.label);
      continue;
    }
    missingIndexes.push({ platform: platform.label, reason: verdict.reason });
  }

  const updated: Lead = { ...lead, dateLastResearched: deps.now, directoryCheckedAt: deps.now };
  let summary: string;
  let resolved: boolean;

  if (listedOn) {
    // Found is a complete answer on its own. It does not matter whether the
    // other platforms were readable — they already book online.
    updated.onlineBookingStatus = "THIRD_PARTY_BOOKING_SYSTEM";
    updated.bookingMethod = "ONLINE_THIRD_PARTY";
    updated.bookingProvider = listedOn.platform.label;
    updated.analysisVersion = ANALYSIS_VERSION;
    updated.locationEvidence = [
      ...lead.locationEvidence,
      `Listed on ${listedOn.platform.label} as "${listedOn.matchedName}" — ${listedOn.profileUrl}`,
    ];
    resolved = true;
    summary = `${lead.businessName}: already books via ${listedOn.platform.label} — a slower sale, not a dead one.`;
  } else if (missingIndexes.length === 0 && checked.length > 0) {
    updated.onlineBookingStatus = "NONE";
    updated.bookingMethod = lead.instagram || lead.facebook ? "SOCIAL_DM" : "PHONE_ONLY";
    updated.analysisVersion = ANALYSIS_VERSION;
    updated.locationEvidence = [
      ...lead.locationEvidence,
      `Not in the ${checked.join(" or ")} ${lead.industry.replace(/-/g, " ")} directory for ${lead.city}.`,
    ];
    resolved = true;
    summary = `${lead.businessName}: no online booking anywhere we can see — a real prospect.`;
  } else {
    updated.locationEvidence = [
      ...lead.locationEvidence,
      `Booking still unknown — no directory yet for ${missingIndexes.map((m) => m.platform).join(", ")} in ${lead.city}.`,
    ];
    resolved = false;
    summary = `${lead.businessName}: still unknown — ${missingIndexes.length} directory not read.`;
  }

  // Re-scored only when something was learned. Scoring an unresolved lead
  // would spend the version stamp without earning it, and the lead would leave
  // the holding area carrying the same unanswered question it went in with.
  if (resolved) {
    const result = await scoreLead(updated, deps.scoringConfig, deps.reasoning);
    updated.prospectScore = result.score;
    updated.scoreBreakdown = result.breakdown;
    updated.scoreReason = result.scoreReason;
    updated.dataConfidence = result.confidence;
    updated.qualificationStatus = qualificationStatusForScore(result.score, deps.scoringConfig);
  }

  return {
    lead: updated,
    summary,
    resolved,
    missingIndexes,
    scoreBefore,
    scoreAfter: updated.prospectScore,
  };
}
