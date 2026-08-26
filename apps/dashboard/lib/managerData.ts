import "server-only";
import {
  AiManager,
  selectBrain,
  DeterministicCommandParser,
  CommsService,
  ContactResolver,
  PipedriveReader,
  ResendEmailProvider,
  TwilioSmsProvider,
  type BrainDescription,
} from "@market-outreach/core";
import { getManager, getRepos } from "./data";
import { isDemoMode } from "./demo";

/**
 * Server-only wiring for the AI Manager.
 *
 * Built per request rather than held as a module singleton: on serverless each
 * invocation may be a different instance anyway, and the brain is chosen from
 * the environment, which can change between deploys without a code change.
 */
/**
 * The Communications Centre, wired from the environment.
 *
 * Built here rather than in core so the providers read the real environment in
 * exactly one place. Both providers are always constructed — an unconfigured
 * one reports what it is missing, which is far more useful than a null that
 * makes the Manager say "communications are unavailable" with no reason.
 */
export function getComms(): CommsService {
  return new CommsService({
    repo: getRepos().communications,
    email: new ResendEmailProvider(),
    sms: new TwilioSmsProvider(),
  });
}

/** Read-only Pipedrive access. Needs only a token — no live-sync switch. */
export function getPipedriveReader(): PipedriveReader {
  return new PipedriveReader();
}

export function getAiManager(): AiManager {
  const repos = getRepos();
  const pipedrive = getPipedriveReader();
  return new AiManager({
    repos,
    brain: selectBrain().brain,
    manager: getManager(),
    commandParser: new DeterministicCommandParser(),
    comms: getComms(),
    contacts: new ContactResolver({
      pipedrive: pipedrive.configured ? pipedrive : null,
      leads: repos.leads,
    }),
    pipedrive,
    // The demo's database is a read-only snapshot, so the Manager answers
    // questions but records nothing and refuses to change anything.
    persist: !isDemoMode,
  });
}

/**
 * Which brain is answering, and why.
 *
 * Surfaced in the UI so the owner is never guessing whether they're talking to
 * a language model or a pattern matcher — the difference changes how they
 * should phrase things.
 */
export function getBrainDescription(): BrainDescription {
  return selectBrain();
}
