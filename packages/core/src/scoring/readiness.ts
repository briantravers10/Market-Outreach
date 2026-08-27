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

/**
 * Why a lead is being held back.
 *
 * "Booking unknown" is split in two because the two halves need completely
 * different work and one of them is far larger. A business whose site we read
 * without finding an answer may still be settled by re-reading it; a business
 * with no website at all never will be, and only the booking directories can
 * ever close it. Collapsing them into one bucket hid twenty-four thousand
 * leads that the website research was never going to reach.
 */
export type HoldReason =
  | "never-researched"
  | "booking-unknown-no-website"
  | "booking-unknown-after-read"
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
  lead: Pick<
    Lead,
    "onlineBookingStatus" | "analysisVersion" | "websiteCheckedAt" | "isDuplicateOf" | "website" | "verifiedAt"
  >
): Readiness {
  if (lead.isDuplicateOf) {
    return {
      ready: false,
      reason: "duplicate",
      explanation: "Folded into another record for the same business.",
    };
  }

  /**
   * A person looked at this one, and said so.
   *
   * Checked before every automated condition, and above the version check in
   * particular. The version check exists to re-open leads whenever the robot
   * research improves, and applying it here would drag hand-checked leads back
   * into the holding area every time it is bumped — which, if someone is being
   * paid by the day to fill that area in, quietly throws away their work.
   *
   * The booking question still has to have an answer. Someone recording only
   * "yes they have a website" has not established the thing the pitch rests on.
   */
  if (lead.verifiedAt && lead.onlineBookingStatus !== "UNKNOWN") {
    return { ready: true, reason: null, explanation: "Checked by hand." };
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
    return lead.website
      ? {
          ready: false,
          reason: "booking-unknown-after-read",
          explanation: "Their website was read but did not say whether they book online.",
        }
      : {
          ready: false,
          reason: "booking-unknown-no-website",
          explanation:
            "No website to read, so only the booking platforms can answer this — they may well be on Booksy or Vagaro.",
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

/**
 * What is actually being done about each hold reason, in one line.
 *
 * The owner's question about the holding area was not "how many" but "what am
 * I waiting for". A count with no answer to that reads as a stall.
 */
export function describeHoldRemedy(reason: HoldReason): string {
  switch (reason) {
    case "never-researched":
      return "The Website Analyst will reach them; nothing needed from you.";
    case "booking-unknown-after-read":
      return "Queued for a booking-platform search, which can settle it where the site could not.";
    case "booking-unknown-no-website":
      return "Only a booking-platform search can settle these. Nothing on their own site will ever answer it.";
    case "stale-method":
      return "Being re-read by the current method. This queue drains on its own.";
    case "duplicate":
      return "Nothing to do — the other record for this business carries the research.";
  }
}

/** Plain-English label for a hold reason, for grouping counts in the dashboard. */
export function describeHoldReason(reason: HoldReason): string {
  switch (reason) {
    case "never-researched":
      return "Waiting to be researched";
    case "booking-unknown-after-read":
      return "Website read, booking unclear";
    case "booking-unknown-no-website":
      return "No website — needs a directory search";
    case "stale-method":
      return "Being re-checked";
    case "duplicate":
      return "Duplicate";
  }
}
