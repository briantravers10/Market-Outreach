import { getLinkSignals, type LinkSignalsConfig } from "../config";

/**
 * What a link on a prospect's link-in-bio page is *for*.
 *
 * This is the interpretation layer over a link-in-bio page — the single
 * highest-signal public artifact for a social-first business. What someone
 * links to answers the qualification question directly: a booking-platform
 * link means they already have an incumbent, while payment links with no
 * booking link means they're running the whole thing by hand out of their DMs.
 */
export type LinkPurpose =
  | "booking"
  | "payment"
  | "social"
  | "contact"
  | "review"
  | "website"
  | "menu"
  | "other";

export interface DetectedLink {
  url: string;
  /** The button text on the page, when known. */
  label: string | null;
  purpose: LinkPurpose;
  /** Recognised platform, e.g. "GlossGenius", "Venmo". Null for unrecognised destinations. */
  provider: string | null;
  /** For booking links only: how complete a booking system it is. */
  tier: "integrated" | "third_party" | null;
  /** Why it was classified this way — keeps the judgement auditable. */
  reason: string;
}

/** Extracts a lowercase hostname, or null if the URL is unparseable. */
function hostnameOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Suffix match so app.acuityscheduling.com matches acuityscheduling.com. */
function hostMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return host === d || host.endsWith(`.${d}`);
}

/**
 * Label keywords that reveal intent when the destination domain doesn't.
 * A custom domain booking page ("book.anas-makeup.com") is invisible to a
 * domain registry, but its button almost always says "Book".
 */
const LABEL_HINTS: Array<{ pattern: RegExp; purpose: LinkPurpose; reason: string }> = [
  { pattern: /\b(book|booking|appointment|schedule|reserve|inquire|inquiry)\b/i, purpose: "booking", reason: "Link text mentions booking" },
  { pattern: /\b(deposit|pay|payment|invoice|tip)\b/i, purpose: "payment", reason: "Link text mentions payment" },
  { pattern: /\b(price|pricing|menu|services|rates|packages)\b/i, purpose: "menu", reason: "Link text mentions prices or services" },
  { pattern: /\b(review|testimonial)\b/i, purpose: "review", reason: "Link text mentions reviews" },
  { pattern: /\b(email|contact|text|call|whatsapp|dm)\b/i, purpose: "contact", reason: "Link text mentions contact" },
];

/**
 * Classifies a single link. Deterministic and explainable — no model call.
 *
 * This is real logic, not a placeholder: it works against genuine URLs today.
 * Only the *fetching* of the page is mocked this phase.
 */
export function classifyLink(
  rawUrl: string,
  label: string | null = null,
  config: LinkSignalsConfig = getLinkSignals()
): DetectedLink {
  const base = { url: rawUrl, label, tier: null as DetectedLink["tier"] };

  // Scheme-based links carry their purpose explicitly.
  const scheme = rawUrl.slice(0, rawUrl.indexOf(":")).toLowerCase();
  if (scheme === "mailto") {
    return { ...base, purpose: "contact", provider: "Email", reason: "mailto: link" };
  }
  if (scheme === "tel" || scheme === "sms") {
    return { ...base, purpose: "contact", provider: scheme === "tel" ? "Phone" : "SMS", reason: `${scheme}: link` };
  }

  const host = hostnameOf(rawUrl);
  if (!host) {
    return { ...base, purpose: "other", provider: null, reason: "Unparseable URL" };
  }

  for (const p of config.booking.platforms) {
    if (hostMatches(host, p.domain)) {
      return {
        ...base,
        purpose: "booking",
        provider: p.name,
        tier: p.tier,
        reason: `Booking platform (${p.name})`,
      };
    }
  }
  for (const p of config.payment.platforms) {
    if (hostMatches(host, p.domain)) {
      return { ...base, purpose: "payment", provider: p.name, reason: `Payment app (${p.name})` };
    }
  }
  for (const p of config.contact.platforms) {
    if (hostMatches(host, p.domain)) {
      return { ...base, purpose: "contact", provider: p.name, reason: `Messaging link (${p.name})` };
    }
  }
  for (const p of config.review.platforms) {
    if (hostMatches(host, p.domain)) {
      return { ...base, purpose: "review", provider: p.name, reason: `Reviews/listing (${p.name})` };
    }
  }
  for (const p of config.social.platforms) {
    if (hostMatches(host, p.domain)) {
      return { ...base, purpose: "social", provider: p.name, reason: `Social profile (${p.name})` };
    }
  }
  for (const h of config.linkInBioHosts) {
    if (hostMatches(host, h.domain)) {
      return { ...base, purpose: "other", provider: h.name, reason: `Another link-in-bio page (${h.name})` };
    }
  }

  // Domain unrecognised — fall back to what the button says.
  if (label) {
    for (const hint of LABEL_HINTS) {
      if (hint.pattern.test(label)) {
        return { ...base, purpose: hint.purpose, provider: null, reason: `${hint.reason} ("${label}")` };
      }
    }
  }

  return { ...base, purpose: "website", provider: null, reason: "Unrecognised destination — treated as own website" };
}

export interface LinkAnalysis {
  links: DetectedLink[];
  /** The booking platform found, if any. Highest-tier match wins. */
  bookingProvider: string | null;
  bookingTier: "integrated" | "third_party" | null;
  hasBookingLink: boolean;
  hasPaymentLink: boolean;
  hasOwnWebsite: boolean;
  /** Plain-English read of what this page implies commercially. */
  summary: string;
}

/**
 * Interprets a whole page of links.
 *
 * The commercially interesting case is deliberately called out: payment links
 * present, booking link absent. That combination means the business is
 * collecting deposits manually while coordinating bookings by DM — the exact
 * workflow an integrated booking product replaces.
 */
export function analyzeLinks(links: DetectedLink[]): LinkAnalysis {
  const booking = links.filter((l) => l.purpose === "booking");
  // An "integrated" industry platform outranks a generic scheduler when both appear.
  const best = booking.find((l) => l.tier === "integrated") ?? booking[0] ?? null;
  const hasPaymentLink = links.some((l) => l.purpose === "payment");
  const hasOwnWebsite = links.some((l) => l.purpose === "website");

  let summary: string;
  if (best) {
    summary = `Already books online via ${best.provider ?? "an online booking tool"} — an incumbent is in place.`;
  } else if (hasPaymentLink) {
    summary =
      "Takes payments or deposits by hand with no booking link — bookings are being coordinated manually, most likely by DM.";
  } else if (links.length === 0) {
    summary = "No link-in-bio page found, so nothing could be inferred from one.";
  } else {
    summary = "No booking link of any kind — enquiries have nowhere to go but the DMs.";
  }

  return {
    links,
    bookingProvider: best?.provider ?? null,
    bookingTier: best?.tier ?? null,
    hasBookingLink: Boolean(best),
    hasPaymentLink,
    hasOwnWebsite,
    summary,
  };
}
