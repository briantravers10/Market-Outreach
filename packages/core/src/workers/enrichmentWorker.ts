import type { DiscoveredLeadSeed } from "../types";
import type { EnrichmentProvider, EnrichmentResult } from "../providers/enrichmentProvider";

/**
 * Enrichment Worker — gathers raw research facts about a discovered
 * business (contact info, staffing, reviews, social presence, services).
 * Delegates the actual research to an EnrichmentProvider (mock now, real
 * research/scraping/API later).
 */
export async function runEnrichmentWorker(
  seed: DiscoveredLeadSeed,
  jobSeed: string,
  provider: EnrichmentProvider
): Promise<EnrichmentResult> {
  return provider.enrich(seed, jobSeed);
}
