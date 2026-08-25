import Link from "next/link";
import { describeEffect, summarizeAllAgents } from "@market-outreach/core";
import { getRepos } from "../../../../lib/data";

export const dynamic = "force-dynamic";

/**
 * The team from the Manager's point of view: what each employee is doing and
 * what standing orders they're operating under.
 */
export default async function ManagerEmployeesPage() {
  const repos = getRepos();
  const [summaries, instructions] = await Promise.all([
    summarizeAllAgents(repos.agentActivity, repos.humanReview),
    repos.instructions.list({ status: "active", limit: 200 }),
  ]);

  return (
    <div>
      {summaries.map((s) => {
        const theirs = instructions.filter((i) => i.agentId === s.id);
        return (
          <div className="panel" key={s.id}>
            <div className="instruction-card-head">
              <h2 style={{ margin: 0 }}>
                <Link href={`/team/${s.id}`}>{s.name}</Link> <small>{s.role}</small>
              </h2>
              <span className={`agent-status agent-status-${s.status}`}>
                <span className="agent-status-dot" />
                {s.status === "working" ? "Working" : s.status === "disabled" ? "Disabled" : "Idle"}
              </span>
            </div>

            <p className="muted" style={{ fontSize: 13, margin: "6px 0 10px" }}>{s.description}</p>

            <div className="agent-card-stats" style={{ marginBottom: 10 }}>
              <span>{s.jobsProcessed} jobs</span>
              <span>{s.errorCount} errors</span>
              <span>{s.humanReviewCount} awaiting review</span>
            </div>

            {s.status === "working" && s.currentTask && (
              <div className="agent-card-task">Now: {s.currentTask}</div>
            )}
            {s.status === "idle" && s.lastCompletedTask && (
              <div className="agent-card-task">Last: {s.lastCompletedTask}</div>
            )}

            <h2 style={{ marginTop: 16, fontSize: 13 }}>
              Standing orders <small>({theirs.length})</small>
            </h2>
            {theirs.length === 0 ? (
              <p className="muted" style={{ fontSize: 12.5 }}>None.</p>
            ) : (
              theirs.map((i) => (
                <div className="activity-row" key={i.id}>
                  <span className="activity-summary">
                    {i.instruction}
                    <div className="instruction-meta">{describeEffect(i.effect)}</div>
                  </span>
                  <span className={`tag ${i.effect ? "tag-enforced" : "tag-advisory"}`}>
                    {i.effect ? "Enforced" : "Advisory"}
                  </span>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
