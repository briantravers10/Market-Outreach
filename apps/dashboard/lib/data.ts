import "server-only";
import {
  ResendEmailProvider,
  TwilioSmsProvider,
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

/**
 * What is actually switched on, read from the deployment rather than asserted.
 *
 * The sidebar used to carry the literal strings "Dry run" and "Off" as
 * hardcoded text under a heading reading "Not live". That is the worst kind of
 * wrong: the CRM had been made live weeks earlier and the navigation still
 * said it was a preview, so a bulk push that writes to a real Pipedrive
 * account looked like a rehearsal. A label that asserts a state instead of
 * reading it is a lie waiting for the state to change.
 */
export function getIntegrationStatus(): {
  crm: { live: boolean; tag: string; explanation: string };
  email: { ready: boolean; explanation: string };
  sms: { ready: boolean; explanation: string };
  outreachTag: string;
} {
  const crm = describePipedriveMode();
  const email = new ResendEmailProvider().readiness();
  const sms = new TwilioSmsProvider().readiness();

  const outreachTag =
    email.ready && sms.ready ? "Email + SMS" : email.ready ? "Email only" : sms.ready ? "SMS only" : "Off";

  return {
    crm: { live: crm.live, tag: crm.live ? "Live" : "Dry run", explanation: crm.explanation },
    email: { ready: email.ready, explanation: email.explanation },
    sms: { ready: sms.ready, explanation: sms.explanation },
    outreachTag,
  };
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
