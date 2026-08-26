import type { Lead, PipelineStageName } from "../types";

/**
 * Turns a business observed in the Overture Maps places dataset into a Lead.
 *
 * Overture is the system of record for discovery because, unlike Google Places,
 * its licence (CDLA Permissive v2.0) lets us keep what we read. It is also
 * unusually generous: roughly 95% of the records carry a phone number and 72% a
 * social profile, so a single free dataset covers discovery and a good part of
 * enrichment at once.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: record what the source said, and
 * nothing else. Overture knows whether a business has a website. It does not
 * know whether that website takes bookings, how many staff work there, or
 * whether the Instagram account has posted this year. Every one of those stays
 * UNKNOWN until something actually looks — and UNKNOWN scores nothing, because
 * the scoring evaluators test for NONE specifically. A lead that looks
 * mediocre here is a lead nobody has finished researching, not a bad lead.
 */

/** One line of the NDJSON produced by scripts/fetch-overture.py. */
export interface OvertureObservation {
  overtureId: string;
  name: string;
  industry: string;
  overtureCategory: string;
  alternateCategories: string[];
  address: string;
  city: string;
  state: string;
  zip: string;
  websites: string[];
  phones: string[];
  socials: string[];
  emails: string[];
  confidence: number | null;
  latitude: number | null;
  longitude: number | null;
}

export const OVERTURE_SOURCE = "overture-places";

/** Stages an import can honestly claim: we found them, and we recorded what the source knew. */
export const OVERTURE_STAGES: PipelineStageName[] = ["discovery", "enrichment"];

function firstMatching(urls: string[], hosts: string[]): string | null {
  for (const url of urls) {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return url;
  }
  return null;
}

/**
 * US phone numbers arrive from Overture in every shape its contributors used:
 * "3059884469", "+17864043049", "(305) 279-7942". Normalising to one display
 * form matters more than it looks — the deduplication pass compares phone
 * numbers directly, so three spellings of one number are three businesses.
 */
export function normalizePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return raw.trim() || null;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/**
 * A website is the single most important thing this dataset tells us, so it is
 * worth being fussy about what counts. A link to the business's own site is a
 * website; a link to their Facebook page is a social profile that someone
 * filed in the wrong column, and treating it as a website would hide exactly
 * the prospect we most want to find.
 */
const SOCIAL_HOSTS = ["facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "tiktok.com", "youtube.com"];

export function realWebsite(websites: string[]): string | null {
  for (const url of websites) {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    return url;
  }
  return null;
}

export interface ObservationContext {
  campaignId: string;
  jobId: string;
  /** Pass the existing lead's id when re-importing, so a refresh updates rather than duplicates. */
  existingId?: string;
  now: string;
}

export function observationToLead(observation: OvertureObservation, context: ObservationContext): Lead {
  const website = realWebsite(observation.websites);
  // A social link filed under `websites` is still evidence of a social profile.
  const allSocials = [...observation.socials, ...observation.websites];
  const instagram = firstMatching(allSocials, ["instagram.com"]);
  const facebook = firstMatching(allSocials, ["facebook.com"]);

  const evidence = [`Listed in Overture Maps as "${observation.overtureCategory}"`];
  if (observation.address) evidence.push(`Street address on file: ${observation.address}`);
  if (observation.confidence !== null) {
    evidence.push(`Source confidence ${observation.confidence.toFixed(2)}`);
  }

  return {
    id: context.existingId ?? crypto.randomUUID(),
    businessName: observation.name,
    industry: observation.industry,
    address: observation.address,
    city: observation.city,
    state: observation.state,
    zip: observation.zip,
    phone: normalizePhone(observation.phones[0]),
    email: observation.emails[0] ?? null,
    website,
    websiteStatus: website ? "EXISTS" : "NONE",
    // Knowing a website exists is not knowing whether it is any good. That
    // judgement needs the page fetched and read, which has not happened.
    websiteQuality: "UNKNOWN",
    onlineBookingStatus: "UNKNOWN",
    bookingProvider: null,
    bookingMethod: "UNKNOWN",
    staffCount: null,
    staffCountConfidence: "LOW",
    rating: null,
    reviewCount: null,
    instagram,
    facebook,
    // Having a profile URL says nothing about whether anyone posts to it.
    socialActivity: "UNKNOWN",
    locationCount: null,
    services: [],

    prospectScore: null,
    scoreBreakdown: [],
    scoreReason: null,
    dataConfidence: "LOW",

    discoverySource: OVERTURE_SOURCE,
    externalId: observation.overtureId,
    sourceConfidence: observation.confidence,
    latitude: observation.latitude,
    longitude: observation.longitude,
    // Nobody has read their site yet — that is the Website Analyst's job.
    websiteCheckedAt: null,
    // Freshly discovered: no research method has been applied yet, so it is
    // held out of the working list until the sweep reaches it.
    analysisVersion: null,
    dateDiscovered: context.now,
    dateLastResearched: context.now,
    researchStatus: "ENRICHED",
    qualificationStatus: "UNQUALIFIED",
    pipelineStage: "RESEARCH",

    linkInBioUrl: null,
    detectedLinks: [],
    serviceArea: null,
    locationConfidence: observation.address ? "HIGH" : "LOW",
    locationEvidence: evidence,

    campaignId: context.campaignId,
    jobId: context.jobId,
    isDuplicateOf: null,
    stagesCompleted: [...OVERTURE_STAGES],

    notes: "",
  };
}
