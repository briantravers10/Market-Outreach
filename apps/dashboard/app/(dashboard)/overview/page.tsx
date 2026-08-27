import Link from "next/link";
import { getIndustries, summarizeAllAgents } from "@market-outreach/core";
import { getRepos } from "../../../lib/data";
import { bucketsFor, leadCountsByCampaign } from "../../../lib/leadStats";
import { KpiTile } from "../../../components/KpiTile";
import { AgentStatusBadge } from "../../../components/AgentStatusBadge";
import { LiveRefresh } from "../../../components/LiveRefresh";
import { QueueHealth } from "../../../components/QueueHealth";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const repos = getRepos();
  const jobs = await repos.jobs.list();
  const campaigns = await repos.campaigns.list();
  const industryLabels = new Map(getIndustries().map((i) => [i.id, i.label]));

  // Aggregates, not rows. This page polls itself every few seconds, and at
  // seventy-seven thousand leads pulling the table each time is what emptied
  // the connection pool.
  const stats = await repos.leads.summaryStats();
  const byCity = await bucketsFor(repos.leads, "city", { limit: 12 });
  const byIndustry = await bucketsFor(repos.leads, "industry", { labels: industryLabels });
  const campaignLeads = await leadCountsByCampaign(repos.leads);

  const summary = {
    businessesDiscovered: stats.total,
    businessesResearched: stats.researched,
    highPriorityLeads: stats.highPriority,
    averageProspectScore: stats.averageScore,
    jobsPending: jobs.filter((j) => j.status === "pending").length,
    jobsFailedOrRetry: jobs.filter((j) => j.status === "failed" || j.status === "retry").length,
    jobsHumanReview: jobs.filter((j) => j.status === "human_review").length,
  };
  const agents = await summarizeAllAgents(repos.agentActivity, repos.humanReview);

  const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const health = await repos.leads.queueHealth(anHourAgo);
  const queueRows = [
    {
      name: "Reading websites",
      queued: health.websiteQueue,
      movedLastHour: health.websiteMovedSince,
      detail: health.oldestWebsiteCheck
        ? `Working oldest-first; the oldest was last read ${health.oldestWebsiteCheck.slice(0, 10)}`
        : "Nothing has been read yet",
    },
    {
      name: "Searching booking platforms",
      queued: health.directoryQueue,
      movedLastHour: health.directoryMovedSince,
      detail: "Businesses whose booking question their own website could not answer",
    },
  ];
  const activeCampaigns = campaigns.filter((c) => c.status === "running");

  return (
    <div>
      <LiveRefresh />
      <div className="page-header">
        <h1>Overview</h1>
        <p>Every business found so far, across all campaigns, cities and industries.</p>
      </div>

      <div className="kpi-grid">
        <KpiTile label="Businesses Discovered" value={summary.businessesDiscovered} />
        <KpiTile label="Businesses Researched" value={summary.businessesResearched} />
        <KpiTile label="Leads Scored" value={stats.scored} />
        <KpiTile label="High-Priority Leads" value={summary.highPriorityLeads} />
        <KpiTile label="Avg Prospect Score" value={summary.averageProspectScore ?? "—"} />
        <KpiTile label="Active Campaigns" value={activeCampaigns.length} />
        <KpiTile label="Pending Jobs" value={summary.jobsPending} />
        <KpiTile label="Failed Jobs" value={summary.jobsFailedOrRetry} />
        <KpiTile label="Human-Review Items" value={summary.jobsHumanReview} />
      </div>

      <QueueHealth rows={queueRows} />

      <div className="grid-2">
        <div className="panel">
          <h2>Active Campaigns <small>({activeCampaigns.length})</small></h2>
          {activeCampaigns.length === 0 ? (
            <p className="empty-state">No campaigns running right now. Assign one from Campaigns.</p>
          ) : (
            activeCampaigns.map((c) => {
              const campaignJobs = jobs.filter((j) => j.campaignId === c.id);
              const completeJobs = campaignJobs.filter((j) => j.status === "complete").length;
              const progress = {
                leadsDiscovered: campaignLeads.total.get(c.id) ?? 0,
                leadsQualified: campaignLeads.qualified.get(c.id) ?? 0,
                completionPct: campaignJobs.length === 0 ? 0 : Math.round((completeJobs / campaignJobs.length) * 100),
              };
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
