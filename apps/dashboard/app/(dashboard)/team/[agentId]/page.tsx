import Link from "next/link";
import { notFound } from "next/navigation";
import { summarizeAgent, type AgentId } from "@market-outreach/core";
import { getRepos } from "../../../../lib/data";
import { sendAgentCommandAction } from "../../../../lib/actions";
import { AgentStatusBadge } from "../../../../components/AgentStatusBadge";
import { CommandBox } from "../../../../components/CommandBox";
import { LiveRefresh } from "../../../../components/LiveRefresh";
import { QualificationBadge, ScorePill } from "../../../../components/Badges";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const repos = getRepos();
  const agent = summarizeAgent(agentId as AgentId, repos.agentActivity, repos.humanReview);
  if (!agent) notFound();

  const recentActivity = repos.agentActivity.list({ agentId: agent.id, limit: 25 });
  const reviewItems = repos.humanReview.list({ agentId: agent.id, status: "open" });

  const recentLeadIds = Array.from(new Set(recentActivity.filter((a) => a.leadId).map((a) => a.leadId as string))).slice(0, 8);
  const recentLeads = recentLeadIds.map((id) => repos.leads.getById(id)).filter((l): l is NonNullable<typeof l> => l !== null);

  return (
    <div>
      <LiveRefresh />
      <div className="page-header">
        <p>
          <Link href="/team" className="muted">← Back to Team</Link>
        </p>
        <h1>{agent.name}</h1>
        <p>{agent.role}</p>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Status</h2>
          <div style={{ marginBottom: 10 }}>
            <AgentStatusBadge status={agent.status} />
          </div>
          <p className="muted" style={{ marginTop: 0 }}>{agent.description}</p>

          <h2 style={{ marginTop: 18 }}>Current Assignment</h2>
          <p>{agent.disabled ? "Not active this phase." : agent.currentTask ?? "Nothing in progress right now."}</p>

          <h2 style={{ marginTop: 18 }}>Progress</h2>
          <div className="agent-card-stats" style={{ borderTop: "none", paddingTop: 0 }}>
            <div><strong>{agent.jobsProcessed}</strong> jobs touched</div>
            <div><strong>{agent.errorCount}</strong> errors</div>
            <div><strong>{agent.humanReviewCount}</strong> needs review</div>
          </div>

          <h2 style={{ marginTop: 18 }}>Permitted Actions</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {agent.permittedActions.length === 0 && <li className="muted">None — this agent is disabled.</li>}
            {agent.permittedActions.map((a) => <li key={a}>{a}</li>)}
          </ul>

          <h2 style={{ marginTop: 18 }}>Prohibited Actions</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-dim)" }}>
            {agent.prohibitedActions.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>

        <div className="panel">
          <h2>Direct Instruction</h2>
          {agent.disabled ? (
            <p className="disabled-banner">This agent isn't active this phase — no instructions to give it yet.</p>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                Recorded on this agent's activity log. This phase, direct instructions are logged for visibility —
                they don't yet change how mock discovery/research runs.
              </p>
              <CommandBox
                action={sendAgentCommandAction.bind(null, agent.id)}
                placeholder={`Give ${agent.name} an instruction…`}
                buttonLabel="Send"
              />
            </>
          )}

          <h2 style={{ marginTop: 20 }}>Errors / Human Review <small>({reviewItems.length} open)</small></h2>
          {reviewItems.length === 0 ? (
            <p className="empty-state">Nothing needs review.</p>
          ) : (
            reviewItems.map((item) => (
              <div className="activity-row" key={item.id}>
                <span className="activity-time">{new Date(item.createdAt).toLocaleString()}</span>
                <span className="activity-summary level-human_review">{item.reason}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Recent Activity</h2>
          {recentActivity.length === 0 ? (
            <p className="empty-state">No activity yet.</p>
          ) : (
            recentActivity.map((a) => (
              <div className="activity-row" key={a.id}>
                <span className="activity-time">{new Date(a.createdAt).toLocaleTimeString()}</span>
                <span className={`activity-summary level-${a.level}`}>{a.summary}</span>
              </div>
            ))
          )}
        </div>

        <div className="panel">
          <h2>Recent Results</h2>
          {recentLeads.length === 0 ? (
            <p className="empty-state">No leads touched yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Business</th><th>Score</th><th>Status</th></tr>
              </thead>
              <tbody>
                {recentLeads.map((lead) => (
                  <tr key={lead.id}>
                    <td><Link href={`/leads/${lead.id}`}>{lead.businessName}</Link></td>
                    <td><ScorePill score={lead.prospectScore} /></td>
                    <td><QualificationBadge status={lead.qualificationStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
