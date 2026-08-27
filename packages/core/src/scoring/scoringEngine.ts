import type { ConfidenceLevel, Lead, ScoreFactorResult, ScoreResult } from "../types";
import type { ScoringConfig, ScoringFactorConfig } from "../config";
import type { ReasoningProvider } from "../reasoning/reasoningProvider";
import { ANALYSIS_VERSION } from "./readiness";

/**
 * One evaluator per factor `id` in config/scoring-config.json. Each returns
 * whether the factor applies to this lead and a short human-readable reason.
 * Points/enabled/thresholds are read from config, NOT hard-coded here — so
 * the sales philosophy stays editable without a code change. Only whether a
 * factor *exists as a checkable condition at all* lives in code.
 *
 * A factor id present in config but absent from this map is skipped (logged
 * by the caller) — this is how the config can describe future factors
 * (e.g. "poor-fit-industry") before the matching signal exists yet.
 */
type FactorEvaluator = (
  lead: Lead,
  confidence: ConfidenceLevel,
  params: Record<string, number> | undefined
) => { applies: boolean; reason: string };

const EVALUATORS: Record<string, FactorEvaluator> = {
  "no-website": (lead) => ({
    applies: lead.websiteStatus === "NONE",
    reason: "No website found during research.",
  }),
  "poor-website": (lead) => ({
    applies: lead.websiteStatus === "EXISTS" && lead.websiteQuality === "POOR",
    reason: "Website exists but was assessed as poor/outdated.",
  }),
  // No "excellent-website" evaluator: the factor was removed from
  // scoring-config.json because the real analyzer cannot produce
  // websiteQuality = EXCELLENT from page markup, so it had never fired on a
  // real lead. Only the synthetic-data worker emits that value, which means
  // keeping the factor would have scored demo leads and never real ones —
  // worse than not having it. See the note in scoring-config.json.
  "no-online-booking": (lead) => ({
    applies: lead.onlineBookingStatus === "NONE",
    reason: "No online booking capability detected.",
  }),
  "phone-only-booking": (lead) => ({
    applies: lead.bookingMethod === "PHONE_ONLY",
    reason: "Customers currently book by phone only.",
  }),
  "social-dm-booking": (lead) => ({
    applies: lead.bookingMethod === "SOCIAL_DM",
    reason: "Booking happens informally via social media DMs.",
  }),
  "sophisticated-booking-incumbent": (lead) => ({
    applies: lead.onlineBookingStatus === "INTEGRATED_BOOKING_SYSTEM",
    reason: "Already has an integrated booking system in place.",
  }),
  "third-party-booking-incumbent": (lead) => ({
    applies: lead.onlineBookingStatus === "THIRD_PARTY_BOOKING_SYSTEM",
    reason: `Uses a third-party booking tool${lead.bookingProvider ? ` (${lead.bookingProvider})` : ""} — a switchable incumbent.`,
  }),
  "multiple-staff": (lead, _c, params) => {
    const minStaff = params?.minStaff ?? 3;
    return {
      applies: (lead.staffCount ?? 0) >= minStaff,
      reason: `${lead.staffCount ?? 0} staff — scheduling coordination is a real pain point.`,
    };
  },
  "strong-reviews": (lead, _c, params) => {
    const minRating = params?.minRating ?? 4.4;
    const minReviewCount = params?.minReviewCount ?? 40;
    return {
      applies: (lead.rating ?? 0) >= minRating && (lead.reviewCount ?? 0) >= minReviewCount,
      reason: `${lead.rating ?? "?"} rating across ${lead.reviewCount ?? 0} reviews — proven demand.`,
    };
  },
  "social-presence-no-website": (lead) => ({
    applies: lead.websiteStatus === "NONE" && Boolean(lead.instagram || lead.facebook),
    reason: "Has a social profile but no website — the audience exists with nowhere to book.",
  }),
  "active-social-presence": (lead) => ({
    applies: lead.socialActivity === "ACTIVE",
    reason: "Active on social media but lacking a way to convert that traffic to bookings.",
  }),
  "established-business": (lead, _c, params) => {
    const minLocations = params?.minLocations ?? 2;
    return {
      applies: (lead.locationCount ?? 1) >= minLocations,
      reason: `${lead.locationCount} locations — established, multi-site operation.`,
    };
  },
  "inactive-business": (lead) => ({
    applies: lead.socialActivity === "INACTIVE" && lead.websiteStatus === "NONE",
    reason: "No website and no active social signal — may not be a going concern.",
  }),
  "insufficient-data": (lead, confidence) => ({
    applies: confidence === "LOW",
    reason: "Too little reliable data was gathered to evaluate this lead confidently.",
  }),
};

/**
 * The facts that decide whether a row can be trusted, and how each is settled.
 *
 * Every one of these is obtainable from what this system actually collects.
 * That is the whole point, and it was the bug: confidence used to be measured
 * over seven fields, three of which — staff count, rating, review count —
 * were never populated for a single lead in seventy-seven thousand. The top
 * grade needed 80% of seven, so HIGH was arithmetically unreachable and the
 * badge silently degenerated into "has a website / does not", labelling the
 * best prospects in the database as the least trustworthy data.
 *
 * "No website" resolves this rather than failing it. Establishing that a
 * business has no site is an answer, and for this operation it is the single
 * most valuable one — treating it as a gap inverted the whole measure.
 */
interface ConfidenceCheck {
  label: string;
  missing: string;
  test: (lead: Lead, currentVersion: number) => boolean;
  /**
   * A check whose absence caps the grade at LOW however many others pass.
   *
   * Counting every fact equally is wrong here. Whether a business books online
   * is what the entire pitch rests on and what the readiness gate holds leads
   * back for — a lead missing it is not "three-quarters trustworthy", it is
   * one nobody should be ringing yet. A threshold cannot express that, because
   * a threshold only knows how many passed, not which.
   */
  decisive?: boolean;
}

const CONFIDENCE_CHECKS: Record<string, ConfidenceCheck> = {
  contact_route: {
    label: "a way to reach them",
    missing: "no phone, email or social profile",
    test: (lead) => Boolean(lead.phone || lead.email || lead.instagram || lead.facebook),
  },
  web_presence: {
    label: "their web presence",
    missing: "nobody has established whether they have a website",
    // Either an address, or a checked absence. UNREACHABLE counts: we tried
    // and that IS what we found.
    test: (lead) => Boolean(lead.website) || lead.websiteStatus === "NONE" || lead.websiteStatus === "UNREACHABLE",
  },
  booking: {
    label: "whether they book online",
    missing: "the booking question is unanswered",
    test: (lead) => lead.onlineBookingStatus !== "UNKNOWN",
    decisive: true,
  },
  current_method: {
    label: "researched by the current method",
    missing: "researched by an older method",
    test: (lead, currentVersion) => Boolean(lead.verifiedAt) || (lead.analysisVersion ?? 0) >= currentVersion,
  },
};

export function computeDataConfidence(
  lead: Lead,
  config: ScoringConfig,
  /**
   * The research version that counts as current.
   *
   * Passed rather than imported so this stays a pure function of its inputs
   * and the scoring module does not depend on the readiness module.
   */
  currentVersion = 2
): { level: ConfidenceLevel; reason: string; resolvedRatio: number } {
  const { keyFields, thresholds } = config.confidence;
  const checks = keyFields.filter((field) => field in CONFIDENCE_CHECKS);

  // A config naming nothing this code knows how to check would otherwise
  // divide by zero and grade everything the same, which is the failure this
  // whole rewrite exists to remove.
  if (checks.length === 0) {
    return { level: "LOW", resolvedRatio: 0, reason: "No confidence checks are configured." };
  }

  const missing: string[] = [];
  let resolved = 0;
  let decisiveMissing = false;
  for (const field of checks) {
    const check = CONFIDENCE_CHECKS[field];
    if (check.test(lead, currentVersion)) {
      resolved += 1;
    } else {
      missing.push(check.missing);
      if (check.decisive) decisiveMissing = true;
    }
  }

  const ratio = resolved / checks.length;
  const level: ConfidenceLevel = decisiveMissing
    ? "LOW"
    : ratio >= thresholds.high
      ? "HIGH"
      : ratio >= thresholds.medium
        ? "MEDIUM"
        : "LOW";

  return {
    level,
    resolvedRatio: ratio,
    // Names what is missing rather than reporting a fraction. "3/4 resolved"
    // tells you nothing you can act on; "the booking question is unanswered"
    // tells you exactly what would improve it.
    reason:
      missing.length === 0
        ? `Everything that matters for a call is established: ${checks
            .map((f) => CONFIDENCE_CHECKS[f].label)
            .join(", ")}.`
        : `Missing: ${missing.join("; ")}.`,
  };
}

export async function scoreLead(
  lead: Lead,
  config: ScoringConfig,
  reasoning: ReasoningProvider
): Promise<ScoreResult> {
  const { level: confidenceLevel, reason: confidenceReason } = computeDataConfidence(lead, config, ANALYSIS_VERSION);

  const breakdown: ScoreFactorResult[] = [];
  for (const factor of config.factors) {
    if (!factor.enabled) continue;
    const evaluator = EVALUATORS[factor.id];
    if (!evaluator) continue; // factor described in config but not yet implemented in code
    const { applies, reason } = evaluator(lead, confidenceLevel, factor.params);
    if (applies) {
      breakdown.push({ id: factor.id, label: factor.label, category: factor.category, points: factor.points, reason });
    }
  }

  const rawScore = config.baseScore + breakdown.reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(config.scoreRange.min, Math.min(config.scoreRange.max, Math.round(rawScore)));

  const scoreReason = await reasoning.summarizeScore(lead.businessName, breakdown, score);

  return { score, breakdown, scoreReason, confidence: confidenceLevel, confidenceReason };
}

export function qualificationStatusForScore(
  score: number,
  config: ScoringConfig
): "DISQUALIFIED" | "UNQUALIFIED" | "QUALIFIED" | "HIGH_PRIORITY" {
  const { highPriorityMin, qualifiedMin, disqualifiedMax } = config.qualification;
  if (score >= highPriorityMin) return "HIGH_PRIORITY";
  if (score >= qualifiedMin) return "QUALIFIED";
  if (score <= disqualifiedMax) return "DISQUALIFIED";
  return "UNQUALIFIED";
}

export type { ScoringFactorConfig };
