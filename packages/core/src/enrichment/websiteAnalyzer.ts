import type { BookingMethod, OnlineBookingStatus, WebsiteQuality } from "../types";
import { classifyLink, analyzeLinks, type DetectedLink } from "./linkClassifier";
import type { FetchedPage } from "./siteFetcher";

/**
 * Reads a prospect's website and answers the question the whole score turns on:
 * can their customers book online, and with whom?
 *
 * The judgement is deliberately evidence-based rather than clever. Every
 * conclusion traces to something literally present in the HTML — a link to a
 * known booking platform, a "Book Now" anchor, a viewport tag — because a
 * salesperson picking up the phone needs to be able to check the claim in ten
 * seconds. An LLM reading the page could say more, but it could also be
 * confidently wrong about a business we are about to ring.
 *
 * Where the evidence runs out the answer stays UNKNOWN. That is not a
 * cop-out: an unanswered question scores nothing, whereas a guess scores
 * points that were never earned.
 */

/** Anchor text that means "book" in this trade, in the languages these markets use. */
const BOOKING_WORDS = [
  "book now", "book online", "book appointment", "book an appointment", "booking",
  "schedule now", "schedule online", "schedule appointment", "make an appointment",
  "request appointment", "reserve now", "reservar", "reserva", "agendar", "cita",
];

export interface SiteAnalysis {
  websiteQuality: WebsiteQuality;
  onlineBookingStatus: OnlineBookingStatus;
  bookingProvider: string | null;
  bookingMethod: BookingMethod;
  detectedLinks: DetectedLink[];
  /** Human-readable, one line per finding, so any conclusion can be audited. */
  evidence: string[];
  /** True when the fetch itself failed — the lead is marked checked, but nothing is asserted. */
  unreachable: boolean;
}

interface Anchor {
  href: string;
  text: string;
}

/**
 * Pulls anchors out of HTML with a regex rather than a DOM parser.
 *
 * A full parser would be more correct and is not worth 300KB in a serverless
 * bundle for this: we need hrefs and their visible text, both of which survive
 * malformed markup fine. Anything this misses stays UNKNOWN, which is the safe
 * direction to be wrong in.
 */
export function extractAnchors(html: string, baseUrl: string): Anchor[] {
  const anchors: Anchor[] = [];
  const pattern = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const rawHref = match[1].trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) continue;
    let href: string;
    try {
      href = new URL(rawHref, baseUrl).toString();
    } catch {
      continue;
    }
    const text = match[2]
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    anchors.push({ href, text });
    if (anchors.length >= 400) break;
  }
  return anchors;
}

function sameHost(a: string, b: string): boolean {
  try {
    const strip = (h: string) => new URL(h).hostname.toLowerCase().replace(/^www\./, "");
    return strip(a) === strip(b);
  } catch {
    return false;
  }
}

/**
 * A conservative read of build quality.
 *
 * Only signals that are unambiguous in the markup count. "No viewport tag" in
 * 2026 genuinely means the site predates mobile or was never maintained, and
 * that is a real sales opening. Everything softer — visual design, copy,
 * whether the photos are any good — is left alone rather than guessed at.
 */
export function assessQuality(html: string, page: FetchedPage): { quality: WebsiteQuality; evidence: string[] } {
  const evidence: string[] = [];
  if (!html.trim()) return { quality: "UNKNOWN", evidence };

  const lower = html.toLowerCase();
  let penalties = 0;
  let credits = 0;

  const hasViewport = /<meta[^>]+name\s*=\s*["']viewport["']/i.test(html);
  if (!hasViewport) {
    penalties += 2;
    evidence.push("No mobile viewport tag — the site predates mobile or was never updated for it.");
  } else {
    credits += 1;
  }

  if (page.finalUrl.startsWith("http://")) {
    penalties += 1;
    evidence.push("Serves over plain HTTP — browsers mark it 'not secure'.");
  }

  // A copyright line several years stale is the clearest "nobody maintains
  // this" signal a page can give, and it is checkable by eye in one second.
  const years = [...lower.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,20}(20\d\d)/g)].map((m) => Number(m[1]));
  const newest = years.length ? Math.max(...years) : null;
  if (newest !== null && newest <= 2022) {
    penalties += 2;
    evidence.push(`Copyright notice stops at ${newest} — the site has not been touched in years.`);
  }

  if (/wix\.com|weebly\.com|godaddysites\.com|squarespace\.com|wordpress\.com/i.test(lower)) {
    credits += 1;
    evidence.push("Built on a hosted website builder.");
  }

  if (html.length < 2_000) {
    penalties += 1;
    evidence.push("Almost no page content — likely a placeholder or parked domain.");
  }

  // Three bands only. A finer scale would imply a precision the evidence
  // cannot support, and POOR vs AVERAGE is the only distinction that changes
  // what you say on the phone.
  if (penalties >= 3) return { quality: "POOR", evidence };
  if (penalties >= 1) return { quality: "AVERAGE", evidence };
  if (credits >= 1) return { quality: "GOOD", evidence };
  return { quality: "AVERAGE", evidence };
}

export function analyzeSite(page: FetchedPage, options: { hasSocialProfile: boolean }): SiteAnalysis {
  const evidence: string[] = [];

  if (page.error || !page.html) {
    return {
      websiteQuality: "UNKNOWN",
      // A site we could not reach tells us nothing about their booking. It is
      // tempting to read a dead site as "no online booking", but a business
      // whose site is merely down still might book through Booksy.
      onlineBookingStatus: "UNKNOWN",
      bookingProvider: null,
      bookingMethod: "UNKNOWN",
      detectedLinks: [],
      evidence: [`Could not read the site: ${page.error ?? "empty response"}.`],
      unreachable: true,
    };
  }

  if (page.status >= 400) {
    return {
      websiteQuality: "UNKNOWN",
      onlineBookingStatus: "UNKNOWN",
      bookingProvider: null,
      bookingMethod: "UNKNOWN",
      detectedLinks: [],
      evidence: [`Site returned HTTP ${page.status}.`],
      unreachable: true,
    };
  }

  const anchors = extractAnchors(page.html, page.finalUrl);
  // Only outbound links are worth classifying: a link to their own /contact
  // page is not evidence of anything, and classifying hundreds of internal
  // links would bury the two that matter.
  const external = anchors.filter((a) => !sameHost(a.href, page.finalUrl));
  const detectedLinks: DetectedLink[] = external.map((a) => classifyLink(a.href, a.text || null));
  const analysis = analyzeLinks(detectedLinks);

  const { quality, evidence: qualityEvidence } = assessQuality(page.html, page);
  evidence.push(...qualityEvidence);

  let onlineBookingStatus: OnlineBookingStatus;
  let bookingMethod: BookingMethod;
  let bookingProvider: string | null = null;

  if (analysis.hasBookingLink) {
    bookingProvider = analysis.bookingProvider;
    if (analysis.bookingTier === "integrated") {
      onlineBookingStatus = "INTEGRATED_BOOKING_SYSTEM";
      bookingMethod = "ONLINE_INTEGRATED";
    } else {
      onlineBookingStatus = "THIRD_PARTY_BOOKING_SYSTEM";
      bookingMethod = "ONLINE_THIRD_PARTY";
    }
    evidence.push(`Links out to ${bookingProvider ?? "an online booking tool"} — an incumbent is already in place.`);
  } else {
    // No link to a known platform. Before concluding they have nothing, check
    // whether the page is *trying* to send people somewhere to book — an
    // in-house booking page still counts as online booking, and calling it
    // "none" would be wrong in the most expensive direction.
    const lowerAnchors = anchors.map((a) => a.text.toLowerCase());
    const bookingWord = BOOKING_WORDS.find((word) => lowerAnchors.some((text) => text.includes(word)));
    if (bookingWord) {
      onlineBookingStatus = "THIRD_PARTY_BOOKING_SYSTEM";
      bookingMethod = "ONLINE_THIRD_PARTY";
      bookingProvider = null;
      evidence.push(
        `A "${bookingWord}" link on the page, but not to any platform we recognise — worth a look before you call.`
      );
    } else {
      onlineBookingStatus = "NONE";
      bookingMethod = options.hasSocialProfile ? "SOCIAL_DM" : "PHONE_ONLY";
      evidence.push(
        options.hasSocialProfile
          ? "No booking link anywhere on the site, and they have a social profile — enquiries land in the DMs."
          : "No booking link anywhere on the site — customers have to phone."
      );
    }
  }

  if (analysis.hasPaymentLink && !analysis.hasBookingLink) {
    evidence.push("Takes payments or deposits by hand with no booking link — the exact workflow this product replaces.");
  }

  return {
    websiteQuality: quality,
    onlineBookingStatus,
    bookingProvider,
    bookingMethod,
    detectedLinks,
    evidence,
    unreachable: false,
  };
}

/**
 * A business with no website is deliberately NOT analysed here.
 *
 * It is tempting to mark them "no online booking" and move on — they are 23,941
 * of the best-looking leads and it would light the whole cohort up. But a salon
 * with no website can still be on Booksy or Vagaro, where customers find them
 * directly, and that makes them a worse prospect rather than a better one.
 * Asserting NONE would hand out 16 points on a question nobody asked.
 *
 * Resolving them needs a different check — looking them up in the booking
 * platforms' own public directories — which is its own piece of work. Until
 * then they keep the score their observed facts earn: no website, social
 * presence, and an unanswered booking question.
 */
export function needsWebsiteAnalysis(lead: { website: string | null; onlineBookingStatus: string }): boolean {
  return Boolean(lead.website) && lead.onlineBookingStatus === "UNKNOWN";
}
