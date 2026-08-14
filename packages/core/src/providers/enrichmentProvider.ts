import type { ConfidenceLevel, DiscoveredLeadSeed, SocialActivity } from "../types";
import { makeSeededRandom, pick, pickWeighted, intBetween, chance } from "../mockData/random";
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
  fieldsResolved: string[]; // which key fields were successfully "found" — feeds data-confidence scoring
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
    const slug = slugify(seed.businessName);

    const hasPhone = chance(rng, 0.92);
    const hasEmail = chance(rng, 0.55);
    const hasWebsite = chance(rng, 0.65);
    const hasInstagram = chance(rng, 0.7);
    const hasFacebook = chance(rng, 0.5);

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

    const rawBookingSignal: RawBookingSignal = pickWeighted(rng, [
      ["none", 1],
      ["phone", 2],
      ["social", 2],
      ["third_party", 3],
      ["integrated", 2],
    ] as const);

    const staffCount = chance(rng, 0.85) ? intBetween(rng, 1, 12) : null;
    const rating = chance(rng, 0.8) ? Math.round((3 + rng() * 2) * 10) / 10 : null;
    const reviewCount = rating ? intBetween(rng, 3, 400) : null;
    const socialActivity: SocialActivity = (hasInstagram || hasFacebook)
      ? pick(rng, ["ACTIVE", "ACTIVE", "MODERATE", "INACTIVE"] as const)
      : pick(rng, ["INACTIVE", "UNKNOWN"] as const);

    const fieldsResolved: string[] = [];
    if (hasPhone) fieldsResolved.push("phone");
    if (hasEmail) fieldsResolved.push("email");
    if (hasWebsite) fieldsResolved.push("website");
    if (rawBookingSignal !== "none") fieldsResolved.push("online_booking_status");
    if (staffCount !== null) fieldsResolved.push("staff_count");
    if (rating !== null) fieldsResolved.push("rating");
    if (reviewCount !== null) fieldsResolved.push("review_count");

    return {
      phone: hasPhone ? generatePhone(rng) : null,
      email: hasEmail ? `info@${slug || "business"}.example` : null,
      website: hasWebsite ? `https://${slug || "business"}.example.com` : null,
      rawWebsiteSignal,
      rawBookingSignal,
      staffCount,
      staffCountConfidence: staffCount === null ? "LOW" : pick(rng, ["HIGH", "HIGH", "MEDIUM"] as const),
      rating,
      reviewCount,
      instagram: hasInstagram ? `@${slug || "business"}` : null,
      facebook: hasFacebook ? `facebook.com/${slug || "business"}` : null,
      socialActivity,
      locationCount: chance(rng, 0.12) ? intBetween(rng, 2, 4) : 1,
      services: generateServices(rng, seed.industry, intBetween(rng, 2, 5)),
      fieldsResolved,
    };
  }
}
