import {
  ProspectingManager,
  MockDiscoveryProvider,
  MockEnrichmentProvider,
  MockReasoningProvider,
  MockCrmAdapter,
  getScoringConfig,
  getTerritories,
} from "@market-outreach/core";
import { createRepositories } from "@market-outreach/db";

/** Builds a ProspectingManager wired with mock providers and the local SQLite repositories. */
export function buildManager() {
  const repos = createRepositories();
  return new ProspectingManager({
    repos,
    discovery: new MockDiscoveryProvider(),
    enrichment: new MockEnrichmentProvider(),
    reasoning: new MockReasoningProvider(),
    crm: new MockCrmAdapter(repos.crm),
    scoringConfig: getScoringConfig(),
    territories: getTerritories(),
  });
}
