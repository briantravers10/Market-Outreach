import type { Lead } from "../types";

function normalize(input: string | null | undefined): string {
  return (input ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

/**
 * Deduplication Worker — deterministic fuzzy match against existing leads.
 * Flags (does not delete) likely duplicates so a human/qualification step
 * can decide; matching is intentionally simple and explainable.
 */
export function findLikelyDuplicate(candidate: Pick<Lead, "businessName" | "address" | "phone" | "city">, existing: Lead[]): Lead | null {
  const candidateName = normalize(candidate.businessName);
  const candidateAddress = normalize(candidate.address);
  const candidatePhone = normalize(candidate.phone);

  for (const other of existing) {
    if (other.city !== candidate.city) continue;

    const sameName = normalize(other.businessName) === candidateName && candidateName.length > 0;
    const sameAddress = normalize(other.address) === candidateAddress && candidateAddress.length > 0;
    const samePhone = candidatePhone.length > 0 && normalize(other.phone) === candidatePhone;

    if (samePhone || (sameName && sameAddress) || sameName) {
      return other;
    }
  }
  return null;
}
