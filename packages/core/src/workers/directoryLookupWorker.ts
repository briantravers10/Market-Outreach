import type { Lead } from "../types";
import type { ScoringConfig } from "../config";
import type { ReasoningProvider } from "../reasoning/reasoningProvider";
import type { DirectoryLookup, DirectoryPlatform } from "../enrichment/bookingDirectory";
import { lookupWithFallback } from "../enrichment/directoryLookups";
import { scoreLead, qualificationStatusForScore } from "../scoring/scoringEngine";
import { ANALYSIS_VERSION } from "../scoring/readiness";

/**
 * Settling the booking question for a business whose own website could not.
 *
 * Runs across the platforms until one finds them. Finding them anywhere is a
 * complete answer — they book online — so the search stops. Not finding them
 * is only a complete answer once every platform has been asked and every one
 * has genuinely answered.
 *
 * That last distinction is the whole design. If three platforms say "not
 * listed" and the fourth was blocked, the honest conclusion is UNKNOWN, not
 * NONE: they might well be on the one we could not check. Recording NONE there
 * would hand out the largest positive factor in the model for a search that
 * never happened.
 */

export interface DirectoryLookupResult {
  lead: Lead;
  summary: string;
  /** True when the booking question is now settled either way. */
  resolved: boolean;
  /** Platforms that could not be checked at all. */
  unavailable: { platform: string; reason: string }[];
  scoreBefore: number | null;
  scoreAfter: number | null;
}

export async function lookupBookingDirectories(
  lead: Lead,
  deps: {
    platforms: DirectoryPlatform[];
    lookups: DirectoryLookup[];
    scoringConfig: ScoringConfig;
    reasoning: ReasoningProvider;
    now: string;
  }
): Promise<DirectoryLookupResult> {
  const scoreBefore = lead.prospectScore;
  const enabled = deps.platforms.filter((p) => p.enabled);

  const unavailable: { platform: string; reason: string }[] = [];
  const checked: string[] = [];
  let found: { platform: string; profileUrl: string; matchedName: string } | null = null;

  for (const platform of enabled) {
    const { outcome } = await lookupWithFallback(lead, platform, deps.lookups);

    if (outcome.kind === "found") {
      found = { platform: outcome.platform, profileUrl: outcome.profileUrl, matchedName: outcome.matchedName };
      break;
    }
    if (outcome.kind === "not_listed") {
      checked.push(platform.label);
      continue;
    }
    unavailable.push({ platform: platform.label, reason: outcome.reason });
  }

  const updated: Lead = { ...lead, dateLastResearched: deps.now };
  let summary: string;
  let resolved: boolean;

  if (found) {
    const platform = enabled.find((p) => p.id === found.platform);
    updated.onlineBookingStatus = "THIRD_PARTY_BOOKING_SYSTEM";
    updated.bookingMethod = "ONLINE_THIRD_PARTY";
    updated.bookingProvider = platform?.label ?? found.platform;
    updated.analysisVersion = ANALYSIS_VERSION;
    updated.locationEvidence = [
      ...lead.locationEvidence,
      `Books through ${platform?.label ?? found.platform} — listed as "${found.matchedName}" at ${found.profileUrl}.`,
    ];
    resolved = true;
    summary = `${lead.businessName}: already books via ${platform?.label ?? found.platform} — not a prospect.`;
  } else if (unavailable.length === 0 && checked.length > 0) {
    // Every platform answered, and none of them has this business.
    updated.onlineBookingStatus = "NONE";
    updated.bookingMethod = lead.instagram || lead.facebook ? "SOCIAL_DM" : "PHONE_ONLY";
    updated.analysisVersion = ANALYSIS_VERSION;
    updated.locationEvidence = [
      ...lead.locationEvidence,
      `Not listed on ${checked.join(", ")} — no online booking found anywhere.`,
    ];
    resolved = true;
    summary = `${lead.businessName}: no online booking on any platform — a real prospect.`;
  } else {
    // Some platform could not be reached. The question stays open, and the
    // lead stays in the holding area rather than being scored on a guess.
    updated.locationEvidence = [
      ...lead.locationEvidence,
      `Booking still unknown — could not check ${unavailable.map((u) => u.platform).join(", ")}.`,
    ];
    resolved = false;
    summary = `${lead.businessName}: still unknown — ${unavailable.length} platform${unavailable.length === 1 ? "" : "s"} unreachable.`;
  }

  // Re-scored only when something was actually learned. Re-scoring on an
  // unresolved lookup would burn the version stamp without earning it, and the
  // lead would leave the holding area with the same unanswered question.
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
    unavailable,
    scoreBefore,
    scoreAfter: updated.prospectScore,
  };
}
