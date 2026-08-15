import type { AgentActivityRepository, AgentId, HumanReviewRepository } from "../types";
import { getAgentConfigs, type AgentConfig } from "../config";

export type AgentLiveStatus = "working" | "idle" | "disabled";

export interface AgentSummary {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  permittedActions: string[];
  prohibitedActions: string[];
  disabled: boolean;
  status: AgentLiveStatus;
  currentTask: string | null;
  lastCompletedTask: string | null;
  jobsProcessed: number;
  errorCount: number;
  humanReviewCount: number;
}

/** An agent reads as "Working" if it logged something within this window. */
const WORKING_WINDOW_MS = 20_000;

/**
 * Computes an agent's live status/current-task/counters purely from its
 * config identity plus the agent_activity/human_review_items logs — nothing
 * about "status" is ever stored directly, so it can never drift out of sync
 * with what actually happened.
 */
export function summarizeAgent(
  agentId: AgentId,
  activityRepo: AgentActivityRepository,
  humanReviewRepo: HumanReviewRepository,
  configs: AgentConfig[] = getAgentConfigs()
): AgentSummary | null {
  const config = configs.find((a) => a.id === agentId);
  if (!config) return null;

  if (config.disabled) {
    return {
      id: agentId,
      name: config.name,
      role: config.role,
      description: config.description,
      permittedActions: config.permittedActions,
      prohibitedActions: config.prohibitedActions,
      disabled: true,
      status: "disabled",
      currentTask: null,
      lastCompletedTask: null,
      jobsProcessed: 0,
      errorCount: 0,
      humanReviewCount: 0,
    };
  }

  const activity = activityRepo.list({ agentId, limit: 200 });
  const latest = activity[0] ?? null;
  const lastInfo = activity.find((a) => a.level === "info") ?? null;
  const isRecent = latest ? Date.now() - new Date(latest.createdAt).getTime() < WORKING_WINDOW_MS : false;

  const jobsProcessed = new Set(activity.filter((a) => a.jobId).map((a) => a.jobId)).size;
  const errorCount = activity.filter((a) => a.level === "error").length;
  const humanReviewCount = humanReviewRepo.list({ agentId, status: "open" }).length;

  return {
    id: agentId,
    name: config.name,
    role: config.role,
    description: config.description,
    permittedActions: config.permittedActions,
    prohibitedActions: config.prohibitedActions,
    disabled: false,
    status: isRecent ? "working" : "idle",
    currentTask: isRecent ? latest!.summary : null,
    lastCompletedTask: lastInfo?.summary ?? null,
    jobsProcessed,
    errorCount,
    humanReviewCount,
  };
}

export function summarizeAllAgents(
  activityRepo: AgentActivityRepository,
  humanReviewRepo: HumanReviewRepository
): AgentSummary[] {
  const configs = getAgentConfigs();
  return configs
    .map((c) => summarizeAgent(c.id as AgentId, activityRepo, humanReviewRepo, configs))
    .filter((s): s is AgentSummary => s !== null);
}
