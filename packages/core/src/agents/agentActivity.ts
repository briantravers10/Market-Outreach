import { randomUUID } from "node:crypto";
import type { AgentActivity, AgentActivityLevel, AgentActivityRepository, AgentId } from "../types";

export interface LogActivityInput {
  agentId: AgentId;
  action: string;
  summary: string;
  campaignId?: string | null;
  jobId?: string | null;
  leadId?: string | null;
  level?: AgentActivityLevel;
}

/**
 * Records one thing a persona did. This — not any mutable "agent state" —
 * is the source of truth the dashboard reads to show what each agent is
 * doing right now and what it's done recently. Called from
 * ProspectingManager.runJob at each pipeline stage.
 */
export async function logActivity(repo: AgentActivityRepository, input: LogActivityInput): Promise<AgentActivity> {
  return repo.log({
    id: randomUUID(),
    agentId: input.agentId,
    campaignId: input.campaignId ?? null,
    jobId: input.jobId ?? null,
    leadId: input.leadId ?? null,
    action: input.action,
    summary: input.summary,
    level: input.level ?? "info",
    createdAt: new Date().toISOString(),
  });
}
