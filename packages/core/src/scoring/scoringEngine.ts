import type { ConfidenceLevel, Lead, ScoreFactorResult, ScoreResult } from "../types";
import type { ScoringConfig, ScoringFactorConfig } from "../config";
import type { ReasoningProvider } from "../reasoning/reasoningProvider";

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
  "excellent-website": (lead) => ({
    applies: lead.websiteStatus === "EXISTS" && lead.websiteQuality === "EXCELLENT",
    reason: "Website is already excellent — less urgency to switch.",
  }),
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

export function computeDataConfidence(
  lead: Lead,
  config: ScoringConfig
): { level: ConfidenceLevel; reason: string; resolvedRatio: number } {
  const { keyFields, thresholds } = config.confidence;
  const leadRecord = lead as unknown as Record<string, unknown>;
  const fieldToLeadKey: Record<string, keyof Lead> = {
    phone: "phone",
    email: "email",
    website: "website",
    online_booking_status: "onlineBookingStatus",
    staff_count: "staffCount",
    rating: "rating",
    review_count: "reviewCount",
  };

  let resolved = 0;
  for (const field of keyFields) {
    const leadKey = fieldToLeadKey[field];
    const value = leadKey ? leadRecord[leadKey] : undefined;
    // "UNKNOWN" is excluded alongside "NONE" deliberately. They mean opposite
    // things about the business and the same thing about us: we do not have a
    // usable value. Counting UNKNOWN as resolved would let a lead nobody has
    // researched report HIGH confidence purely because the field was populated
    // with a placeholder.
    const isResolved =
      value !== null &&
      value !== undefined &&
      value !== "NONE" &&
      value !== "UNKNOWN" &&
      !(typeof value === "string" && value.trim() === "");
    if (isResolved) resolved += 1;
  }

  const ratio = keyFields.length === 0 ? 0 : resolved / keyFields.length;
  const level: ConfidenceLevel = ratio >= thresholds.high ? "HIGH" : ratio >= thresholds.medium ? "MEDIUM" : "LOW";

  return {
    level,
    resolvedRatio: ratio,
    reason: `${resolved}/${keyFields.length} key research fields resolved (${Math.round(ratio * 100)}%).`,
  };
}

export async function scoreLead(
  lead: Lead,
  config: ScoringConfig,
  reasoning: ReasoningProvider
): Promise<ScoreResult> {
  const { level: confidenceLevel, reason: confidenceReason } = computeDataConfidence(lead, config);

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
