import { buildCampaignProgress, buildOverallSummary, getIndustries } from "@market-outreach/core";
import { getRepos } from "../../lib/data";
import { StatusBadge } from "../../components/Badges";
import { KpiTile } from "../../components/KpiTile";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const repos = getRepos();
  const industryLabels = new Map(getIndustries().map((i) => [i.id, i.label]));

  const campaigns = repos.campaigns.list();
  const jobs = repos.jobs.list();
  const leads = repos.leads.list();
  const crmRecords = repos.crm.list();
  const outreachAttempts = repos.outreach.list();

  const summary = buildOverallSummary(leads, jobs);
  const qualificationCounts = {
    UNQUALIFIED: leads.filter((l) => l.qualificationStatus === "UNQUALIFIED").length,
    QUALIFIED: leads.filter((l) => l.qualificationStatus === "QUALIFIED").length,
    HIGH_PRIORITY: leads.filter((l) => l.qualificationStatus === "HIGH_PRIORITY").length,
    DISQUALIFIED: leads.filter((l) => l.qualificationStatus === "DISQUALIFIED").length,
  };

  return (
    <div>
      <div className="page-header">
        <h1>Reports</h1>
        <p>Campaign performance summaries. All figures come from local fake/test data.</p>
      </div>

      <div className="kpi-grid">
        <KpiTile label="Total Campaigns" value={campaigns.length} />
        <KpiTile label="Businesses Discovered" value={summary.businessesDiscovered} />
        <KpiTile label="Qualified Leads" value={summary.qualifiedLeads} />
        <KpiTile label="High Priority" value={summary.highPriorityLeads} />
        <KpiTile label="Avg Score" value={summary.averageProspectScore ?? "—"} />
        <KpiTile label="Pushed to Mock CRM" value={crmRecords.length} />
      </div>

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
