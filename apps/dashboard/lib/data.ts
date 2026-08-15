import "server-only";
import {
  ProspectingManager,
  MockDiscoveryProvider,
  MockEnrichmentProvider,
  MockReasoningProvider,
  MockCrmAdapter,
  DeterministicCommandParser,
  getScoringConfig,
  getTerritories,
  getIndustries,
  getAgentConfigs,
} from "@market-outreach/core";
import { createRepositories } from "@market-outreach/db";

/**
 * Server-only data access layer for the dashboard. Wraps the same
 * @market-outreach/core + @market-outreach/db packages the CLI scripts use,
 * so the dashboard and the pipeline scripts always see identical data and
 * business logic — the dashboard never re-implements scoring or workflow.
 */
export function getRepos() {
  return createRepositories();
}

export function getManager() {
  const repos = getRepos();
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

export function getCommandParser() {
  return new DeterministicCommandParser();
}

export { getScoringConfig, getTerritories, getIndustries, getAgentConfigs };
