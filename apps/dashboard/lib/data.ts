import "server-only";
import {
  ProspectingManager,
  MockDiscoveryProvider,
  MockEnrichmentProvider,
  MockReasoningProvider,
  PipedriveCrmAdapter,
  DeterministicCommandParser,
  getScoringConfig,
  getTerritories,
  getIndustries,
  getAgentConfigs,
  getPipedriveConfig,
  describePipedriveMode,
  buildHandoff,
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
    crm: new PipedriveCrmAdapter(repos.crm),
    scoringConfig: getScoringConfig(),
    territories: getTerritories(),
  });
}

export function getCommandParser() {
  return new DeterministicCommandParser();
}

/**
 * Whether live Pipedrive sync is on, and why. Computed from the environment
 * on every read so the dashboard can never show a stale connection state.
 */
export function getCrmMode() {
  return describePipedriveMode();
}

/** The exact Pipedrive payloads that would be sent for a given lead. Pure — no credentials needed. */
export function getCrmHandoff(lead: Parameters<typeof buildHandoff>[0]) {
  return buildHandoff(lead);
}

export {
  getScoringConfig,
  getTerritories,
  getIndustries,
  getAgentConfigs,
  getPipedriveConfig,
  buildHandoff,
};
