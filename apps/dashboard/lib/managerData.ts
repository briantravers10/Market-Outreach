import "server-only";
import {
  AiManager,
  selectBrain,
  DeterministicCommandParser,
  type BrainDescription,
} from "@market-outreach/core";
import { getManager, getRepos } from "./data";

/**
 * Server-only wiring for the AI Manager.
 *
 * Built per request rather than held as a module singleton: on serverless each
 * invocation may be a different instance anyway, and the brain is chosen from
 * the environment, which can change between deploys without a code change.
 */
export function getAiManager(): AiManager {
  return new AiManager({
    repos: getRepos(),
    brain: selectBrain().brain,
    manager: getManager(),
    commandParser: new DeterministicCommandParser(),
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
