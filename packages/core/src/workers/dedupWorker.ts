import type { Lead } from "../types";

function normalize(input: string | null | undefined): string {
  return (input ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

/** Strips protocol/www/trailing slash so the same site in two formats still matches. */
function normalizeUrl(input: string | null | undefined): string {
  return normalize((input ?? "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, ""));
}

/** Both non-empty and equal. Two unknowns are not a match. */
function bothMatch(a: string, b: string): boolean {
  return a.length > 0 && a === b;
}

export type DedupCandidate = Pick<
  Lead,
  "businessName" | "address" | "phone" | "city" | "website" | "instagram"
>;

/**
 * Deduplication Worker — deterministic, explainable matching against existing leads.
 * Flags (never deletes) likely duplicates so qualification/a human can decide.
 *
 * A match requires a genuinely identifying signal:
 *   - same phone number, or
 *   - same website, or
 *   - same Instagram handle, or
 *   - same business name AND same street address.
 *
 * Name alone is deliberately NOT enough. It used to be, which merged distinct
 * businesses that merely shared a name — a real problem for industries where
 * people trade under a personal brand (makeup artists, trainers), where names
 * like "Glam by Mari" collide often. Two businesses with the same name but
 * different phone numbers and different addresses are two businesses.
 *
 * Empty values never match each other, so the many mobile operators with no
 * street address don't all collapse into one another.
 */
export function findLikelyDuplicate(candidate: DedupCandidate, existing: Lead[]): Lead | null {
  const candidateName = normalize(candidate.businessName);
  const candidateAddress = normalize(candidate.address);
  const candidatePhone = normalize(candidate.phone);
  const candidateWebsite = normalizeUrl(candidate.website);
  const candidateInstagram = normalize(candidate.instagram);

  for (const other of existing) {
    if (other.city !== candidate.city) continue;

    if (bothMatch(candidatePhone, normalize(other.phone))) return other;
    if (bothMatch(candidateWebsite, normalizeUrl(other.website))) return other;
    if (bothMatch(candidateInstagram, normalize(other.instagram))) return other;

    const sameName = bothMatch(candidateName, normalize(other.businessName));
    const sameAddress = bothMatch(candidateAddress, normalize(other.address));
    if (sameName && sameAddress) return other;
  }
  return null;
}

/** Explains why a match was made, for the activity log and Lead Detail. */
export function describeDuplicateMatch(candidate: DedupCandidate, match: Lead): string {
  if (bothMatch(normalize(candidate.phone), normalize(match.phone))) return "same phone number";
  if (bothMatch(normalizeUrl(candidate.website), normalizeUrl(match.website))) return "same website";
  if (bothMatch(normalize(candidate.instagram), normalize(match.instagram))) return "same Instagram handle";
  return "same business name and address";
}
