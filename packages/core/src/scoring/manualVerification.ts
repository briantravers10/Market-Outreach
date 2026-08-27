import type { BookingMethod, Lead, OnlineBookingStatus, WebsiteStatus } from "../types";

/**
 * A person's answer, which outranks every automated one — permanently.
 *
 * The reason this is a separate concept rather than "write the fields and move
 * on" is money. If someone is paid to work through the holding area, their
 * answers have to survive contact with the machinery that put those leads
 * there: the website re-check sweep, the directory crawl, and any future
 * improvement to either. A day's work silently overwritten by the next cron is
 * a day's wages thrown away, and the loss would be invisible — the lead would
 * simply go back to being unknown.
 *
 * So verification is recorded as its own fact — who, when, what they said —
 * and every queue in the system is required to skip a verified lead. The
 * automated version stamp is deliberately NOT what carries this: that number
 * means "which robot method produced this", it gets bumped whenever the
 * research improves, and a bump would drag hand-checked leads back into the
 * queue along with everything else. A human answer is not a version of the
 * automated answer. It replaces it.
 */

/** What someone can tell us about a business they actually looked at. */
export interface VerificationInput {
  /** Whether they found a website. Undefined means "leave what we had". */
  hasWebsite?: boolean;
  /** The address they found, when they found one. */
  website?: string | null;
  /**
   * Which platform the business books through, "none" for no online booking
   * at all, or undefined to leave the booking question alone.
   *
   * "none" is the valuable answer and the one that needs a person: it is a
   * negative, and a negative is exactly what scraping is worst at proving.
   */
  bookingProvider?: string | "none";
  /** Free text: what they saw, where they looked. Shown on the lead. */
  note?: string;
  /** Who is answering. Required — an unattributable answer cannot be checked. */
  verifiedBy: string;
  verifiedAt: string;
}

export interface VerificationOutcome {
  lead: Lead;
  /** Field-by-field, for the audit trail and for the confirmation message. */
  changes: string[];
  /** True when this answer settles the booking question. */
  settlesBooking: boolean;
}

/**
 * Booking providers offered in the dropdown.
 *
 * A free-text box would produce "booksy", "Booksy", "booksy.com" and "BOOKSY"
 * within a week, and the filter that shows which platform a business uses
 * would silently split into four. Anything genuinely not on this list goes in
 * the note, where it reads as a note rather than as data.
 */
export const KNOWN_BOOKING_PROVIDERS = [
  "Booksy",
  "Vagaro",
  "Square Appointments",
  "StyleSeat",
  "Fresha",
  "GlossGenius",
  "Acuity",
  "Calendly",
  "Setmore",
  "Schedulicity",
  "Mindbody",
  "Boulevard",
  "Phorest",
  "The Cut",
  "Squire",
  "Other (see note)",
] as const;

/** Providers that are a booking tool bolted onto the business's own site rather than a marketplace. */
const INTEGRATED_PROVIDERS = new Set(["Acuity", "Calendly", "Setmore", "Boulevard", "Phorest"]);

export function bookingStatusFor(provider: string): OnlineBookingStatus {
  if (provider === "none") return "NONE";
  return INTEGRATED_PROVIDERS.has(provider) ? "INTEGRATED_BOOKING_SYSTEM" : "THIRD_PARTY_BOOKING_SYSTEM";
}

function bookingMethodFor(lead: Lead, provider: string): BookingMethod {
  if (provider !== "none") {
    return INTEGRATED_PROVIDERS.has(provider) ? "ONLINE_INTEGRATED" : "ONLINE_THIRD_PARTY";
  }
  // No online booking. How they DO take bookings is the next question, and the
  // best available answer is whether they have a social presence to message.
  return lead.instagram || lead.facebook ? "SOCIAL_DM" : "PHONE_ONLY";
}

/**
 * Applies one person's findings to a lead.
 *
 * Pure, and returns a new lead rather than mutating: the caller re-scores and
 * writes. Nothing here touches the network or the database, so the rules about
 * what a human answer means are testable on their own.
 */
export function applyVerification(lead: Lead, input: VerificationInput): VerificationOutcome {
  const changes: string[] = [];
  const updated: Lead = { ...lead };

  if (input.hasWebsite !== undefined) {
    const website = input.hasWebsite ? (input.website?.trim() || lead.website) : null;
    const status: WebsiteStatus = input.hasWebsite ? "EXISTS" : "NONE";

    if (updated.websiteStatus !== status) {
      changes.push(`Website: ${lead.websiteStatus} → ${status}`);
      updated.websiteStatus = status;
    }
    if ((website ?? null) !== (lead.website ?? null)) {
      changes.push(website ? `Website address set to ${website}` : "Website address cleared");
      updated.website = website ?? null;
    }
    // Marked as read, by a person. Without this the site sits in the
    // "never read" queue forever despite someone having just looked at it.
    updated.websiteCheckedAt = input.verifiedAt;
  }

  let settlesBooking = false;

  if (input.bookingProvider !== undefined) {
    const provider = input.bookingProvider;
    const status = bookingStatusFor(provider);
    const label = provider === "none" ? null : provider;

    /**
     * One line, in the words someone checking the work would use.
     *
     * The first version emitted "Booking: UNKNOWN → NONE", which is accurate
     * and useless: this list is read by whoever is spot-checking a paid
     * researcher's day, and an enum transition tells them nothing about what
     * was actually claimed.
     */
    const was = lead.bookingProvider ?? (lead.onlineBookingStatus === "NONE" ? "no online booking" : null);
    if (label) {
      changes.push(was && was !== label ? `Books through ${label} (was ${was})` : `Books through ${label}`);
    } else {
      changes.push(was && was !== "no online booking" ? `No online booking (was ${was})` : "No online booking");
    }

    updated.onlineBookingStatus = status;
    updated.bookingProvider = label;
    updated.bookingMethod = bookingMethodFor(updated, provider);
    settlesBooking = true;
  }

  updated.verifiedBy = input.verifiedBy;
  updated.verifiedAt = input.verifiedAt;
  updated.dateLastResearched = input.verifiedAt;

  const note = input.note?.trim();
  updated.locationEvidence = [
    ...lead.locationEvidence,
    note
      ? `Checked by ${input.verifiedBy}: ${note}`
      : `Checked by ${input.verifiedBy}.`,
  ];

  return { lead: updated, changes, settlesBooking };
}

/**
 * Whether a person has answered for this lead.
 *
 * One predicate, used by the readiness gate and by every queue, so there is a
 * single place that decides what "hand-checked" means. Two places deciding
 * that separately is how a verified lead ends up passing the gate and being
 * re-swept by a cron at the same time.
 */
export function isHumanVerified(lead: Pick<Lead, "verifiedAt">): boolean {
  return Boolean(lead.verifiedAt);
}
