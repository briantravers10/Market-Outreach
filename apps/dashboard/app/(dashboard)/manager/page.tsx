import Link from "next/link";
import { summarizeAllAgents, computeMetrics, today, yesterday } from "@market-outreach/core";
import { getRepos } from "../../../lib/data";
import { getBrainDescription } from "../../../lib/managerData";
import { KpiTile } from "../../../components/KpiTile";

export const dynamic = "force-dynamic";

/** Manager overview: the company at a glance, computed live. */
export default async function ManagerOverviewPage() {
  const repos = getRepos();
  const now = new Date();
  const brain = getBrainDescription();

  const [summaries, todayMetrics, yesterdayMetrics, pending, activeInstructions, scheduled, recentReports] =
    await Promise.all([
      summarizeAllAgents(repos.agentActivity, repos.humanReview),
      computeMetrics(repos, today(now), { includeComparison: false }),
      computeMetrics(repos, yesterday(now), { includeComparison: false }),
      repos.managerActions.list({ status: "pending_approval", limit: 20 }),
      repos.instructions.list({ status: "active", limit: 100 }),
      repos.scheduledTasks.list({ active: true }),
      repos.reports.list({ limit: 5 }),
    ]);

  const working = summaries.filter((s) => s.status === "working");
  const enforced = activeInstructions.filter((i) => i.effect !== null).length;

  return (
    <div>
      <div className="kpi-grid">
        <KpiTile label="Employees working" value={`${working.length}/${summaries.filter((s) => !s.disabled).length}`} />
        <KpiTile label="Discovered today" value={todayMetrics.businessesDiscovered} />
        <KpiTile label="Discovered yesterday" value={yesterdayMetrics.businessesDiscovered} />
        <KpiTile label="High priority today" value={todayMetrics.highPriorityLeads} />
        <KpiTile label="Standing instructions" value={activeInstructions.length} />
        <KpiTile label="Awaiting your approval" value={pending.length} />
        <KpiTile label="Needs attention" value={todayMetrics.openHumanReviewItems} />
        <KpiTile label="Scheduled tasks" value={scheduled.length} />
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>How the Manager is understanding you</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>{brain.detail}</p>
        {!brain.usingLlm && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            Everything it reports comes from this database either way — a language model would only
            let you phrase requests more freely.
          </p>
        )}
      </div>

      {pending.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h2>Waiting for your approval <small>({pending.length})</small></h2>
          {pending.map((action) => (
            <div key={action.id} className="instruction-card">
              <div className="instruction-text">{action.intentSummary}</div>
              <div className="instruction-meta">
                Requested {new Date(action.requestedAt).toLocaleString("en-GB")} · risk: {action.risk}
              </div>
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12.5 }}>
            Open the Manager (bottom-right) to approve or decline these.
          </p>
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <h2>Team</h2>
          {summaries.map((s) => (
            <div key={s.id} className="activity-row">
              <Link href={`/team/${s.id}`}>{s.name}</Link>
              <span className={`agent-status agent-status-${s.status}`}>
                <span className="agent-status-dot" />
                {s.status === "working" ? "Working" : s.status === "disabled" ? "Disabled" : "Idle"}
              </span>
            </div>
          ))}
        </div>

        <div className="panel">
          <h2>Standing instructions <small>({activeInstructions.length})</small></h2>
          {activeInstructions.length === 0 ? (
            <p className="empty-state">
              None yet. Tell the Manager something like &ldquo;from now on, don&apos;t include national chains&rdquo;.
            </p>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
                {enforced} of {activeInstructions.length} are enforced automatically; the rest are recorded
                for reference.
              </p>
              {activeInstructions.slice(0, 6).map((i) => (
                <div key={i.id} className="activity-row">
                  <span className="activity-summary">{i.instruction}</span>
                  <span className={`tag ${i.effect ? "tag-enforced" : "tag-advisory"}`}>
                    {i.effect ? "Enforced" : "Advisory"}
                  </span>
                </div>
              ))}
              <p style={{ marginTop: 10 }}>
                <Link className="muted" href="/manager/instructions">→ all instructions</Link>
              </p>
            </>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Latest reports</h2>
          {recentReports.length === 0 ? (
            <p className="empty-state">No reports yet. Ask the Manager for your briefing.</p>
          ) : (
            recentReports.map((r) => (
              <div key={r.id} className="activity-row">
                <Link href={`/manager/reports?id=${r.id}`}>{r.title}</Link>
                <span className="activity-time">{new Date(r.generatedAt).toLocaleDateString("en-GB")}</span>
              </div>
            ))
          )}
        </div>

        <div className="panel">
          <h2>Scheduled</h2>
          {scheduled.length === 0 ? (
            <p className="empty-state">
              Nothing scheduled. Try &ldquo;every morning at 9 give me a progress report&rdquo;.
            </p>
          ) : (
            scheduled.map((t) => (
              <div key={t.id} className="activity-row">
                <span className="activity-summary">{t.name}</span>
                <span className="activity-time">
                  {t.nextRunAt ? new Date(t.nextRunAt).toLocaleString("en-GB") : "—"}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
