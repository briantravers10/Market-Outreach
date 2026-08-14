import type { Lead, QualificationStatus, ScoreResult } from "../types";
import type { ScoringConfig } from "../config";
import type { ReasoningProvider } from "../reasoning/reasoningProvider";
import { qualificationStatusForScore, scoreLead } from "../scoring/scoringEngine";

/**
 * Qualification Worker — applies the configurable prospect score and
 * derives a qualification status from it. Always deterministic/code-driven:
 * this is the layer that must stay transparent and directly editable by
 * the business owner (config/scoring-config.json), not left to a model.
 */
export async function runQualificationWorker(
  lead: Lead,
  config: ScoringConfig,
  reasoning: ReasoningProvider
): Promise<{ scoreResult: ScoreResult; qualificationStatus: QualificationStatus }> {
  const scoreResult = await scoreLead(lead, config, reasoning);
  const qualificationStatus = qualificationStatusForScore(scoreResult.score, config);
  return { scoreResult, qualificationStatus };
}
