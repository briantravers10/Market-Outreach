import type { ConfidenceLevel, DiscoveredLeadSeed, SocialActivity } from "../types";
import { getDiscoveryChannel } from "../config";
import { makeSeededRandom, pick, pickWeighted, intBetween, chance, type Rng } from "../mockData/random";
import { generatePhone, generateServices, slugify } from "../mockData/fakeBusinessNames";

/**
 * Raw signal strength for website quality, before the Website/Booking
 * Analysis Worker interprets it into a final category. Modeling this as a
 * separate "raw signal" stage keeps the enrichment/analysis split real:
 * enrichment gathers facts, analysis makes a judgment call on those facts.
 */
export type RawWebsiteSignal = "none" | "outdated" | "basic" | "modern";
export type RawBookingSignal = "none" | "phone" | "social" | "third_party" | "integrated";

export interface EnrichmentResult {
  phone: string | null;
  email: string | null;
  website: string | null;
  rawWebsiteSignal: RawWebsiteSignal;
  rawBookingSignal: RawBookingSignal;
  staffCount: number | null;
  staffCountConfidence: ConfidenceLevel;
  rating: number | null;
  reviewCount: number | null;
  instagram: string | null;
  facebook: string | null;
  socialActivity: SocialActivity;
  locationCount: number;
  services: string[];
  /** Inferred operating area for a business with no fixed premises. Null when a street address is known. */
  serviceArea: string | null;
  /** How trustworthy serviceArea/city placement is — see Lead.locationConfidence. */
  locationConfidence: ConfidenceLevel;
  /** The signals the location was inferred from, so the guess is auditable rather than magic. */
  locationEvidence: string[];
  fieldsResolved: string[]; // which key fields were successfully "found" — feeds data-confidence scoring
}

/**
 * Infers where a business without a fixed address actually works.
 *
 * This models the real problem for social-first industries: there is no map
 * pin to read, so location has to be triangulated from weaker signals (a bio
 * line, recurring tagged venues, a linked booking page). Each signal is
 * recorded as evidence and the result carries an explicit confidence, because
 * a guessed service area presented as fact is worse than an honest "unsure".
 *
 * The mock produces plausible evidence strings; a real implementation would
 * populate the same shape from actual profile data.
 */
function inferServiceArea(
  rng: Rng,
  city: string,
  hasFixedAddress: boolean,
  instagram: string | null
): { serviceArea: string | null; locationConfidence: ConfidenceLevel; locationEvidence: string[] } {
  if (hasFixedAddress) {
    return {
      serviceArea: null,
      locationConfidence: "HIGH",
      locationEvidence: ["Fixed street address on file"],
    };
  }

  const evidence: string[] = [];
  const bioMentionsCity = chance(rng, 0.6);
  const taggedPostCount = instagram ? intBetween(rng, 0, 18) : 0;
  const bookingLinkArea = chance(rng, 0.35);

  if (bioMentionsCity) evidence.push(`Profile bio names ${city}`);
  if (taggedPostCount >= 4) {
    evidence.push(`${taggedPostCount} recent posts tagged in or near ${city}`);
  } else if (taggedPostCount > 0) {
    evidence.push(`Only ${taggedPostCount} location-tagged post(s) — weak signal`);
  }
  if (bookingLinkArea) evidence.push("Linked booking page lists a service area");

  // Confidence follows how many independent signals agree, not how confident
  // any single one sounds.
  const strongSignals = [bioMentionsCity, taggedPostCount >= 4, bookingLinkArea].filter(Boolean).length;
  const locationConfidence: ConfidenceLevel = strongSignals >= 2 ? "HIGH" : strongSignals === 1 ? "MEDIUM" : "LOW";

  if (strongSignals === 0) {
    evidence.push("No usable location signal found");
    return { serviceArea: null, locationConfidence: "LOW", locationEvidence: evidence };
  }

  const radius = pick(rng, [15, 20, 25, 30, 40]);
  return { serviceArea: `${city} + ${radius}mi`, locationConfidence, locationEvidence: evidence };
}

/**
 * Researches a discovered business in depth.
 *
 * SEAM: a real implementation would call web search / scraping / places
 * detail APIs / an LLM research agent. Downstream workers only depend on
 * this interface's shape, not on how it was produced.
 */
export interface EnrichmentProvider {
  readonly sourceName: string;
  enrich(seed: DiscoveredLeadSeed, jobSeed: string): Promise<EnrichmentResult>;
}

export class MockEnrichmentProvider implements EnrichmentProvider {
  readonly sourceName = "mock-enrichment-v1";

  async enrich(seed: DiscoveredLeadSeed, jobSeed: string): Promise<EnrichmentResult> {
    const rng = makeSeededRandom(`${jobSeed}|${seed.businessName}|enrich`);

    // A business's *identity* — its phone number, Instagram handle, domain —
    // is a property of the business, not of the job that happened to find it.
    // Seeding those on the business itself means re-discovering the same
    // business in a later campaign yields the same identifiers, which is both
    // realistic and what makes identity-based deduplication work at all.
    // Everything else stays on the job seed so research outcomes still vary.
    const identityRng = makeSeededRandom(`${seed.businessName}|${seed.city}|${seed.industry}|identity`);

    const slug = slugify(seed.businessName);
    // Handles and domains are globally unique in reality, so two different
    // artists both trading as "Glam by Sol" have *different* handles. Deriving
    // one from the name alone would make them collide and turn an identity
    // check back into a name check.
    const handle = `${slug || "business"}${pick(identityRng, ["", "", "_mua", "305", "954", "_studio", "beauty", "561"])}`;

    const hasPhone = chance(identityRng, 0.92);
    const hasEmail = chance(identityRng, 0.55);
    // Social-first industries (makeup artists) behave differently from
    // storefronts: Instagram is the business, a standalone website is the
    // exception, and booking usually happens in the DMs. Modeling that here
    // rather than in scoring keeps the score weights industry-neutral.
    const socialFirst = getDiscoveryChannel(seed.industry) === "social-first";

    const hasWebsite = chance(identityRng, socialFirst ? 0.25 : 0.65);
    const hasInstagram = chance(identityRng, socialFirst ? 0.96 : 0.7);
    const hasFacebook = chance(identityRng, socialFirst ? 0.3 : 0.5);

    // Weighted toward a realistic mixed market — not every business is a slam-dunk
    // prospect. Tuned so the resulting score distribution spreads across the 0-100
    // range instead of clustering at the top (see config/scoring-config.json baseScore).
    const rawWebsiteSignal: RawWebsiteSignal = hasWebsite
      ? pickWeighted(rng, [
          ["outdated", 2],
          ["basic", 3],
          ["modern", 3],
        ] as const)
      : "none";

    const rawBookingSignal: RawBookingSignal = socialFirst
      ? pickWeighted(rng, [
          ["none", 2],
          ["phone", 2],
          ["social", 6],
          ["third_party", 2],
          ["integrated", 1],
        ] as const)
      : pickWeighted(rng, [
          ["none", 1],
          ["phone", 2],
          ["social", 2],
          ["third_party", 3],
          ["integrated", 2],
        ] as const);

    // Overwhelmingly solo operators, so a 1-12 staff range would misrepresent them.
    const staffCount = socialFirst
      ? (chance(rng, 0.75) ? intBetween(rng, 1, 2) : null)
      : (chance(rng, 0.85) ? intBetween(rng, 1, 12) : null);
    const rating = chance(rng, 0.8) ? Math.round((3 + rng() * 2) * 10) / 10 : null;
    const reviewCount = rating ? intBetween(rng, 3, 400) : null;
    const socialActivity: SocialActivity = (hasInstagram || hasFacebook)
      ? pick(rng, ["ACTIVE", "ACTIVE", "MODERATE", "INACTIVE"] as const)
      : pick(rng, ["INACTIVE", "UNKNOWN"] as const);

    const location = inferServiceArea(rng, seed.city, seed.address.trim().length > 0, hasInstagram ? `@${handle}` : null);

    const fieldsResolved: string[] = [];
    if (hasPhone) fieldsResolved.push("phone");
    if (hasEmail) fieldsResolved.push("email");
    if (hasWebsite) fieldsResolved.push("website");
    if (rawBookingSignal !== "none") fieldsResolved.push("online_booking_status");
    if (staffCount !== null) fieldsResolved.push("staff_count");
    if (rating !== null) fieldsResolved.push("rating");
    if (reviewCount !== null) fieldsResolved.push("review_count");
    // A mobile business with a well-evidenced service area is *located*, even
    // with no street address — otherwise social-first industries would be
    // penalised on data confidence purely for how they operate.
    if (location.locationConfidence === "HIGH" || location.locationConfidence === "MEDIUM") {
      fieldsResolved.push("location");
    }

    return {
      phone: hasPhone ? generatePhone(identityRng) : null,
      email: hasEmail ? `info@${slug || "business"}.example` : null,
      website: hasWebsite ? `https://${handle}.example.com` : null,
      rawWebsiteSignal,
      rawBookingSignal,
      staffCount,
      staffCountConfidence: staffCount === null ? "LOW" : pick(rng, ["HIGH", "HIGH", "MEDIUM"] as const),
      rating,
      reviewCount,
      instagram: hasInstagram ? `@${handle}` : null,
      facebook: hasFacebook ? `facebook.com/${handle}` : null,
      socialActivity,
      locationCount: !socialFirst && chance(rng, 0.12) ? intBetween(rng, 2, 4) : 1,
      services: generateServices(rng, seed.industry, intBetween(rng, 2, 5)),
      ...location,
      fieldsResolved,
    };
  }
}
