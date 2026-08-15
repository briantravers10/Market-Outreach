import type { AgentLiveStatus } from "@market-outreach/core";

const LABELS: Record<AgentLiveStatus, string> = {
  working: "Working",
  idle: "Idle",
  disabled: "Disabled",
};

export function AgentStatusBadge({ status }: { status: AgentLiveStatus }) {
  return (
    <span className={`agent-status agent-status-${status}`}>
      <span className="agent-status-dot" />
      {LABELS[status]}
    </span>
  );
}
