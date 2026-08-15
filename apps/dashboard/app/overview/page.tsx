import Link from "next/link";
import {
  buildCampaignProgress,
  buildOverallSummary,
  buildProgressByCity,
  buildProgressByIndustry,
  getIndustries,
  summarizeAllAgents,
} from "@market-outreach/core";
import { getRepos } from "../../lib/data";
import { KpiTile } from "../../components/KpiTile";
import { AgentStatusBadge } from "../../components/AgentStatusBadge";
import { LiveRefresh } from "../../components/LiveRefresh";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const repos = getRepos();
  const leads = repos.leads.list();
  const jobs = repos.jobs.list();
  const campaigns = repos.campaigns.list();

  const summary = buildOverallSummary(leads, jobs);
  const byCity = buildProgressByCity(leads);
  const byIndustry = buildProgressByIndustry(leads);
  const industryLabels = new Map(getIndustries().map((i) => [i.id, i.label]));
  const agents = summarizeAllAgents(repos.agentActivity, repos.humanReview);
  const activeCampaigns = campaigns.filter((c) => c.status === "running");

  return (
    <div>
      <LiveRefresh />
      <div className="page-header">
        <h1>Overview</h1>
        <p>Fake-data snapshot across all campaigns, cities, and industries.</p>
      </div>

      <div className="kpi-grid">
        <KpiTile label="Businesses Discovered" value={summary.businessesDiscovered} />
        <KpiTile label="Businesses Researched" value={summary.businessesResearched} />
        <KpiTile label="Leads Scored" value={leads.filter((l) => l.prospectScore !== null).length} />
        <KpiTile label="High-Priority Leads" value={summary.highPriorityLeads} />
        <KpiTile label="Avg Prospect Score" value={summary.averageProspectScore ?? "—"} />
        <KpiTile label="Active Campaigns" value={activeCampaigns.length} />
        <KpiTile label="Pending Jobs" value={summary.jobsPending} />
        <KpiTile label="Failed Jobs" value={summary.jobsFailedOrRetry} />
        <KpiTile label="Human-Review Items" value={summary.jobsHumanReview} />
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Active Campaigns <small>({activeCampaigns.length})</small></h2>
          {activeCampaigns.length === 0 ? (
            <p className="empty-state">No campaigns running right now. Assign one from Campaigns.</p>
          ) : (
            activeCampaigns.map((c) => {
              const progress = buildCampaignProgress(c, jobs, leads);
              return (
                <div key={c.id} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <Link href="/campaigns">{c.city} — {industryLabels.get(c.industry) ?? c.industry}</Link>
                    <span className="muted">{progress.completionPct}%</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-bar-fill" style={{ width: `${progress.completionPct}%` }} />
                  </div>
                </div>
              );
            })
          )}
          <p style={{ marginTop: 10 }}>
            <Link href="/high-priority" className="muted">→ 80+ leads</Link>
            {" · "}
            <Link href="/queue" className="muted">→ full work queue</Link>
          </p>
        </div>

        <div className="panel">
          <h2>AI Team Status</h2>
          {agents.map((a) => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--panel-border)" }}>
              <Link href={`/team/${a.id}`}>{a.name}</Link>
              <AgentStatusBadge status={a.status} />
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Progress by City</h2>
          <table>
            <thead>
              <tr>
                <th>City</th>
                <th>Leads</th>
                <th>Qualified</th>
                <th>High Priority</th>
                <th>Avg Score</th>
              </tr>
            </thead>
            <tbody>
              {byCity.map((b) => (
                <tr key={b.key}>
                  <td>{b.label}</td>
                  <td>{b.totalLeads}</td>
                  <td>{b.qualifiedLeads}</td>
                  <td>{b.highPriorityLeads}</td>
                  <td>{b.averageScore ?? "—"}</td>
                </tr>
              ))}
              {byCity.length === 0 && (
                <tr><td colSpan={5} className="empty-state">No leads yet — run `npm run seed`.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Progress by Industry</h2>
          <table>
            <thead>
              <tr>
                <th>Industry</th>
                <th>Leads</th>
                <th>Qualified</th>
                <th>High Priority</th>
                <th>Avg Score</th>
              </tr>
            </thead>
            <tbody>
              {byIndustry.map((b) => (
                <tr key={b.key}>
                  <td>{industryLabels.get(b.key) ?? b.label}</td>
                  <td>{b.totalLeads}</td>
                  <td>{b.qualifiedLeads}</td>
                  <td>{b.highPriorityLeads}</td>
                  <td>{b.averageScore ?? "—"}</td>
                </tr>
              ))}
              {byIndustry.length === 0 && (
                <tr><td colSpan={5} className="empty-state">No leads yet — run `npm run seed`.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
