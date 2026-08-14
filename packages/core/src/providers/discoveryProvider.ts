import type { DiscoveredLeadSeed } from "../types";
import { makeSeededRandom, intBetween } from "../mockData/random";
import { generateBusinessName, generateStreetAddress, generateZip } from "../mockData/fakeBusinessNames";

export interface DiscoveryParams {
  city: string;
  state: string;
  industry: string;
  batchId: string;
  batchSize: number;
}

/**
 * Finds candidate businesses for a city+industry.
 *
 * SEAM: this interface is what a real integration (Google Places API,
 * Yelp, targeted web search, etc.) would implement later. The rest of the
 * pipeline (enrichment, analysis, scoring) never needs to change — only
 * which DiscoveryProvider is wired into the ProspectingManager.
 */
export interface DiscoveryProvider {
  readonly sourceName: string;
  discover(params: DiscoveryParams): Promise<DiscoveredLeadSeed[]>;
}

/** Generates deterministic fake leads. No network calls, no real businesses. */
export class MockDiscoveryProvider implements DiscoveryProvider {
  readonly sourceName = "mock-discovery-v1";

  async discover(params: DiscoveryParams): Promise<DiscoveredLeadSeed[]> {
    const { city, state, industry, batchId, batchSize } = params;
    const seeds: DiscoveredLeadSeed[] = [];

    for (let i = 0; i < batchSize; i++) {
      const rng = makeSeededRandom(`${city}|${industry}|${batchId}|${i}`);
      seeds.push({
        businessName: generateBusinessName(rng, industry),
        industry,
        address: generateStreetAddress(rng),
        city,
        state,
        zip: generateZip(rng),
        discoverySource: this.sourceName,
      });
    }

    // Simulate the occasional "not enough businesses found in this batch" case.
    const shortfall = intBetween(makeSeededRandom(`${city}|${industry}|${batchId}|shortfall`), 0, 1) === 1;
    return shortfall ? seeds.slice(0, Math.max(1, seeds.length - 1)) : seeds;
  }
}
