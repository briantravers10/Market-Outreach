import {
  buildAgentThroughput,
  buildBookingProviderBreakdown,
  buildBookingStatusBreakdown,
  buildCampaignProgress,
  buildConfidenceBreakdown,
  buildOverallSummary,
  buildWebsiteStatusBreakdown,
  getAgentConfigs,
  getIndustries,
  type PipelineStageName,
} from "@market-outreach/core";
import { getRepos } from "../../../lib/data";
import { StatusBadge } from "../../../components/Badges";
import { KpiTile } from "../../../components/KpiTile";
import { BreakdownBars } from "../../../components/BreakdownBars";

export const dynamic = "force-dynamic";

const STAGES: { key: PipelineStageName; label: string }[] = [
  { key: "discovery", label: "Discovery" },
  { key: "enrichment", label: "Enrichment" },
  { key: "website_analysis", label: "Website analysis" },
  { key: "qualification", label: "Qualification" },
  { key: "deduplication", label: "Deduplication" },
];

export default async function AnalyticsPage() {
  const repos = getRepos();
  const industryLabels = new Map(getIndustries().map((i) => [i.id, i.label]));
  const agentNames = new Map(getAgentConfigs().map((a) => [a.id, a.name]));

  const campaigns = await repos.campaigns.list();
  const jobs = await repos.jobs.list();
  const leads = await repos.leads.list();
  const activity = await repos.agentActivity.list({ limit: 5000 });
  const outreachAttempts = await repos.outreach.list();

  const summary = buildOverallSummary(leads, jobs);
  const qualificationCounts = {
    UNQUALIFIED: leads.filter((l) => l.qualificationStatus === "UNQUALIFIED").length,
    QUALIFIED: leads.filter((l) => l.qualificationStatus === "QUALIFIED").length,
    HIGH_PRIORITY: leads.filter((l) => l.qualificationStatus === "HIGH_PRIORITY").length,
    DISQUALIFIED: leads.filter((l) => l.qualificationStatus === "DISQUALIFIED").length,
  };
  const count80Plus = leads.filter((l) => (l.prospectScore ?? 0) >= 80).length;
  const count90Plus = leads.filter((l) => (l.prospectScore ?? 0) >= 90).length;
  const failedJobs = jobs.filter((j) => j.status === "failed");

  const websiteBreakdown = buildWebsiteStatusBreakdown(leads);
  const bookingBreakdown = buildBookingStatusBreakdown(leads);
  const providerBreakdown = buildBookingProviderBreakdown(leads);
  const confidenceBreakdown = buildConfidenceBreakdown(leads);
  const throughput = buildAgentThroughput(activity);

  return (
    <div>
      <div className="page-header">
        <h1>Analytics</h1>
        <p>What the team has found so far. All figures come from local fake/test data — no sales/conversion data yet, since outreach hasn't begun.</p>
      </div>

      <div className="kpi-grid">
        <KpiTile label="Total Campaigns" value={campaigns.length} />
        <KpiTile label="Businesses Discovered" value={summary.businessesDiscovered} />
        <KpiTile label="Qualified Leads" value={summary.qualifiedLeads} />
        <KpiTile label="Avg Score" value={summary.averageProspectScore ?? "—"} />
        <KpiTile label="80+ Leads" value={count80Plus} />
        <KpiTile label="90+ Leads" value={count90Plus} />
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Lead Distribution by Industry</h2>
          <BreakdownBars items={Object.entries(
            leads.reduce<Record<string, number>>((acc, l) => {
              const label = industryLabels.get(l.industry) ?? l.industry;
              acc[label] = (acc[label] ?? 0) + 1;
              return acc;
            }, {})
          ).map(([key, count]) => ({ key, count, pct: 0 })).sort((a, b) => b.count - a.count)} />
        </div>
        <div className="panel">
          <h2>Lead Distribution by City</h2>
          <BreakdownBars items={Object.entries(
            leads.reduce<Record<string, number>>((acc, l) => {
              acc[l.city] = (acc[l.city] ?? 0) + 1;
              return acc;
            }, {})
          ).map(([key, count]) => ({ key, count, pct: 0 })).sort((a, b) => b.count - a.count)} />
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Website Status</h2>
          <BreakdownBars items={websiteBreakdown} />
        </div>
        <div className="panel">
          <h2>Booking Status</h2>
          <BreakdownBars items={bookingBreakdown} />
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Booking Provider</h2>
          <BreakdownBars items={providerBreakdown} />
        </div>
        <div className="panel">
          <h2>Data Confidence</h2>
          <BreakdownBars items={confidenceBreakdown} />
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Qualification Breakdown</h2>
          <table>
            <thead><tr><th>Status</th><th>Count</th></tr></thead>
            <tbody>
              {Object.entries(qualificationCounts).map(([status, count]) => (
                <tr key={status}>
                  <td><StatusBadge status={status} /></td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Pipeline Completion</h2>
          <table>
            <thead><tr><th>Stage</th><th>Leads</th></tr></thead>
            <tbody>
              {STAGES.map((s) => (
                <tr key={s.key}>
                  <td>{s.label}</td>
                  <td>{leads.filter((l) => l.stagesCompleted.includes(s.key)).length}/{leads.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>Agent Throughput</h2>
        <table>
          <thead><tr><th>Agent</th><th>Actions</th><th>Errors</th><th>Human Review</th></tr></thead>
          <tbody>
            {throughput.map((t) => (
              <tr key={t.agentId}>
                <td>{agentNames.get(t.agentId) ?? t.agentId}</td>
                <td>{t.actionCount}</td>
                <td>{t.errorCount}</td>
                <td>{t.humanReviewCount}</td>
              </tr>
            ))}
            {throughput.length === 0 && <tr><td colSpan={4} className="empty-state">No agent activity yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Campaign Summaries</h2>
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th>Jobs</th>
              <th>Completion</th>
              <th>Leads</th>
              <th>Qualified</th>
              <th>Failed/Retry</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const progress = buildCampaignProgress(c, jobs, leads);
              return (
                <tr key={c.id}>
                  <td>{c.city} — {industryLabels.get(c.industry) ?? c.industry}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{progress.totalJobs}</td>
                  <td>{progress.completionPct}%</td>
                  <td>{progress.leadsDiscovered}</td>
                  <td>{progress.leadsQualified}</td>
                  <td>{progress.failedJobs}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Failed Jobs <small>({failedJobs.length})</small></h2>
        {failedJobs.length === 0 ? (
          <p className="empty-state">No failed jobs.</p>
        ) : (
          <table>
            <thead><tr><th>City</th><th>Industry</th><th>Batch</th><th>Error</th></tr></thead>
            <tbody>
              {failedJobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.city}</td>
                  <td>{industryLabels.get(j.industry) ?? j.industry}</td>
                  <td>{j.batchId}</td>
                  <td className="muted">{j.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Future Outreach Log <small>always disabled in this phase</small></h2>
        {outreachAttempts.length === 0 ? (
          <p className="disabled-banner">No outreach attempts logged. Outreach (Resend/Twilio) is not wired up — status is always DISABLED.</p>
        ) : (
          <table>
            <thead><tr><th>Lead</th><th>Channel</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {outreachAttempts.map((a) => (
                <tr key={a.id}>
                  <td className="muted">{a.leadId.slice(0, 8)}…</td>
                  <td>{a.channel}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td className="muted">{a.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
