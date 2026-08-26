import type { Lead } from "../types";

/**
 * Whether a lead is finished being researched, and therefore safe to call.
 *
 * The owner's requirement, in their words: "I don't want to be wasting my time
 * ringing leads that I don't need to." That makes readiness a gate, not a
 * label. A half-researched lead must not appear in the working list at all —
 * not greyed out, not sorted lower, not there.
 *
 * Two things have to be true, and the second is the one that was missing:
 *
 *   1. The booking question is answered. It is the whole basis of the pitch,
 *      and UNKNOWN means nobody has established it. Ringing a business whose
 *      booking status is unknown is exactly the wasted call.
 *
 *   2. The answer came from the CURRENT method. Improving the research
 *      re-opens every lead the old method decided. Mixing the two in one
 *      ranked list is worse than not improving it at all, because the list
 *      still looks like a ranking while no longer being one.
 */

/**
 * Bump this whenever a change alters what the research would conclude.
 *
 *   1  homepage only, single URL attempt
 *   2  four URL forms tried; inner pages read when the homepage shows no
 *      booking; unreachable recorded as a finding rather than a silence
 *
 * Bumping it moves every older lead back into the holding area automatically,
 * which is the intended effect: they are no longer trustworthy, and saying so
 * is better than leaving them in the list looking finished.
 */
export const ANALYSIS_VERSION = 2;

export type HoldReason =
  | "never-researched"
  | "booking-unknown"
  | "stale-method"
  | "duplicate";

export interface Readiness {
  ready: boolean;
  /** Null when ready. Otherwise why this lead is being held back. */
  reason: HoldReason | null;
  /** One line, in plain words, for the dashboard. */
  explanation: string;
}

export function assessReadiness(
  lead: Pick<Lead, "onlineBookingStatus" | "analysisVersion" | "websiteCheckedAt" | "isDuplicateOf" | "website">
): Readiness {
  if (lead.isDuplicateOf) {
    return {
      ready: false,
      reason: "duplicate",
      explanation: "Folded into another record for the same business.",
    };
  }

  // Never looked at. Distinct from "looked at and could not tell", because the
  // fix is different: this one just needs the queue to reach it.
  if (!lead.websiteCheckedAt && lead.website) {
    return {
      ready: false,
      reason: "never-researched",
      explanation: "Their website has not been read yet.",
    };
  }

  if (lead.onlineBookingStatus === "UNKNOWN") {
    return {
      ready: false,
      reason: "booking-unknown",
      explanation: lead.website
        ? "Their website would not load, so whether they book online is still unknown."
        : "No website to read, so whether they book online is still unknown — they may well be on Booksy or Vagaro.",
    };
  }

  if ((lead.analysisVersion ?? 0) < ANALYSIS_VERSION) {
    return {
      ready: false,
      reason: "stale-method",
      explanation: "Researched by an older method — being re-checked before it can be trusted.",
    };
  }

  return { ready: true, reason: null, explanation: "Fully researched." };
}

/** Plain-English label for a hold reason, for grouping counts in the dashboard. */
export function describeHoldReason(reason: HoldReason): string {
  switch (reason) {
    case "never-researched":
      return "Waiting to be researched";
    case "booking-unknown":
      return "Booking status unknown";
    case "stale-method":
      return "Being re-checked";
    case "duplicate":
      return "Duplicate";
  }
}
