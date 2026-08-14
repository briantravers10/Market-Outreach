import { buildCampaignProgress, getIndustries, getTerritories } from "@market-outreach/core";
import { getRepos } from "../../lib/data";
import { StatusBadge } from "../../components/Badges";
import {
  createCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
  runNextJobAction,
  startCampaignAction,
  stopCampaignAction,
} from "../../lib/actions";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const repos = getRepos();
  const territories = getTerritories();
  const industries = getIndustries();
  const industryLabels = new Map(industries.map((i) => [i.id, i.label]));

  const campaigns = repos.campaigns.list();
  const allJobs = repos.jobs.list();
  const allLeads = repos.leads.list();

  return (
    <div>
      <div className="page-header">
        <h1>Campaign Control</h1>
        <p>Start, pause, resume, and stop campaigns. All controls act only on local test/mock jobs.</p>
      </div>

      <div className="panel">
        <h2>New Campaign</h2>
        <form action={createCampaignAction} className="filter-bar">
          <div className="filter-field">
            <label>City</label>
            <select name="city" required>
              {territories.map((t) => (
                <option key={t.id} value={t.city}>{t.city}</option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label>Industry</label>
            <select name="industry" required>
              {industries.map((i) => (
                <option key={i.id} value={i.id}>{i.label}</option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label>Batch Size</label>
            <input type="number" name="batchSize" defaultValue={5} min={1} max={50} />
          </div>
          <div className="filter-field">
            <label>Target Leads</label>
            <input type="number" name="targetLeadCount" defaultValue={15} min={1} max={500} />
          </div>
          <div className="filter-field">
            <label>Priority (1-5)</label>
            <input type="number" name="priority" defaultValue={3} min={1} max={5} />
          </div>
          <button className="btn" type="submit">Create Campaign</button>
        </form>
      </div>

      <div className="panel">
        <h2>Campaigns <small>({campaigns.length})</small></h2>
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th>Batch Size</th>
              <th>Priority</th>
              <th>Progress</th>
              <th>Leads</th>
              <th>Qualified</th>
              <th>Controls</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const progress = buildCampaignProgress(c, allJobs, allLeads);
              return (
                <tr key={c.id}>
                  <td>
                    {c.city} — {industryLabels.get(c.industry) ?? c.industry}
                  </td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{c.batchSize}</td>
                  <td>{c.priority}</td>
                  <td style={{ minWidth: 160 }}>
                    <div className="progress-bar">
                      <div className="progress-bar-fill" style={{ width: `${progress.completionPct}%` }} />
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                      {progress.completeJobs}/{progress.totalJobs} jobs ({progress.completionPct}%)
                    </div>
                  </td>
                  <td>{progress.leadsDiscovered}</td>
                  <td>{progress.leadsQualified}</td>
                  <td>
                    <div className="btn-row">
                      {c.status === "draft" && (
                        <form action={startCampaignAction.bind(null, c.id)}>
                          <button className="btn-ghost" type="submit">Start</button>
                        </form>
                      )}
                      {c.status === "running" && (
                        <>
                          <form action={runNextJobAction.bind(null, c.id)}>
                            <button className="btn-ghost" type="submit">Run Next Job</button>
                          </form>
                          <form action={pauseCampaignAction.bind(null, c.id)}>
                            <button className="btn-ghost" type="submit">Pause</button>
                          </form>
                          <form action={stopCampaignAction.bind(null, c.id)}>
                            <button className="btn-ghost" type="submit">Stop</button>
                          </form>
                        </>
                      )}
                      {c.status === "paused" && (
                        <>
                          <form action={resumeCampaignAction.bind(null, c.id)}>
                            <button className="btn-ghost" type="submit">Resume</button>
                          </form>
                          <form action={stopCampaignAction.bind(null, c.id)}>
                            <button className="btn-ghost" type="submit">Stop</button>
                          </form>
                        </>
                      )}
                      {c.status === "stopped" && (
                        <form action={startCampaignAction.bind(null, c.id)}>
                          <button className="btn-ghost" type="submit">Restart</button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {campaigns.length === 0 && (
              <tr><td colSpan={8} className="empty-state">No campaigns yet — create one above or run `npm run seed`.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
