import Link from "next/link";
import type { AgentSummary } from "@market-outreach/core";
import { AgentStatusBadge } from "./AgentStatusBadge";

export function AgentCard({ agent }: { agent: AgentSummary }) {
  const taskLine = agent.disabled
    ? agent.description
    : agent.status === "working" && agent.currentTask
      ? agent.currentTask
      : agent.lastCompletedTask
        ? `Last: ${agent.lastCompletedTask}`
        : "No activity yet.";

  return (
    <Link href={`/team/${agent.id}`} className="agent-card">
      <div className="agent-card-header">
        <div>
          <div className="agent-card-name">{agent.name}</div>
          <div className="agent-card-role">{agent.role}</div>
        </div>
        <AgentStatusBadge status={agent.status} />
      </div>
      <div className="agent-card-task">{taskLine}</div>
      {!agent.disabled && (
        <div className="agent-card-stats">
          <div>
            <strong>{agent.jobsProcessed}</strong> jobs
          </div>
          <div>
            <strong>{agent.errorCount}</strong> errors
          </div>
          <div>
            <strong>{agent.humanReviewCount}</strong> review
          </div>
        </div>
      )}
    </Link>
  );
}
