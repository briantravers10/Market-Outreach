import { buildOverallSummary, buildProgressByCity, buildProgressByIndustry, getIndustries } from "@market-outreach/core";
import { getRepos } from "../../lib/data";
import { KpiTile } from "../../components/KpiTile";

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

  return (
    <div>
      <div className="page-header">
        <h1>Overview</h1>
        <p>Fake-data snapshot across all campaigns, cities, and industries.</p>
      </div>

      <div className="kpi-grid">
        <KpiTile label="Businesses Discovered" value={summary.businessesDiscovered} />
        <KpiTile label="Businesses Researched" value={summary.businessesResearched} />
        <KpiTile label="Qualified Leads" value={summary.qualifiedLeads} />
        <KpiTile label="High-Priority Leads" value={summary.highPriorityLeads} />
        <KpiTile label="Avg Prospect Score" value={summary.averageProspectScore ?? "—"} />
        <KpiTile label="Jobs Pending" value={summary.jobsPending} />
        <KpiTile label="Jobs Running" value={summary.jobsRunning} />
        <KpiTile label="Failed / Retry" value={summary.jobsFailedOrRetry} />
        <KpiTile label="Needs Human Review" value={summary.jobsHumanReview} />
        <KpiTile label="Campaigns" value={campaigns.length} />
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
