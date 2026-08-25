import Link from "next/link";
import { buildCampaignProgress, getIndustries, getTerritories } from "@market-outreach/core";
import { getRepos } from "../../../lib/data";
import { StatusBadge } from "../../../components/Badges";
import { ActionButton } from "../../../components/ActionButton";
import { CommandBox } from "../../../components/CommandBox";
import { isDemoMode } from "../../../lib/demo";
import {
  assignTaskAction,
  createCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
  runNextJobAction,
  startCampaignAction,
  stopCampaignAction,
} from "../../../lib/actions";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ assigned?: string; clarify?: string }>;
}) {
  const params = await searchParams;
  const repos = getRepos();
  const territories = getTerritories();
  const industries = getIndustries();
  const industryLabels = new Map(industries.map((i) => [i.id, i.label]));

  const campaigns = await repos.campaigns.list();
  const allJobs = await repos.jobs.list();
  // Lead counts per campaign, computed in SQL. Pulling every lead to count
  // them per campaign is what exhausted the connection pool when this page
  // started polling against a real dataset.
  const leadCounts = new Map(
    (await repos.leads.groupCount("campaign_id")).map((row) => [row.value ?? "", row.count])
  );
  const qualifiedCounts = new Map(
    (await repos.leads.groupCount("campaign_id", { qualificationStatus: "QUALIFIED" })).map(
      (row) => [row.value ?? "", row.count]
    )
  );

  return (
    <div>
      <div className="page-header">
        <h1>Campaigns</h1>
        <p>Tell the Manager what to find, or create a campaign directly. All controls act only on local test/mock jobs.</p>
      </div>

      <div className="panel">
        <h2>Manager Command Box</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          Try: "Find 50 dog groomers in Miami with no online booking." Cities: {territories.map((t) => t.city).join(", ")}.
        </p>
        <CommandBox action={assignTaskAction} placeholder="Find 50 dog groomers in Miami with no online booking…" />
        {params.assigned && (
          <div className="notice-banner notice-success" style={{ marginTop: 14, marginBottom: 0 }}>
            Assigned: <strong>{params.assigned}</strong>. Start it below when you're ready.
          </div>
        )}
        {params.clarify && (
          <div className="notice-banner notice-clarify" style={{ marginTop: 14, marginBottom: 0 }}>
            {params.clarify}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>New Campaign <small>manual form</small></h2>
        {isDemoMode ? (
          <p className="disabled-banner">Campaign creation is disabled in the public read-only demo.</p>
        ) : (
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
        )}
      </div>

      <div className="panel">
        <h2>Campaigns <small>({campaigns.length})</small></h2>
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th>Filters</th>
              <th>Priority</th>
              <th>Progress</th>
              <th>Leads</th>
              <th>Qualified</th>
              <th>Controls</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const campaignJobs = allJobs.filter((j) => j.campaignId === c.id);
              const completeJobs = campaignJobs.filter((j) => j.status === "complete").length;
              const progress = {
                totalJobs: campaignJobs.length,
                pendingJobs: campaignJobs.filter((j) => j.status === "pending").length,
                runningJobs: campaignJobs.filter((j) => j.status === "running").length,
                completeJobs,
                failedJobs: campaignJobs.filter((j) => j.status === "failed" || j.status === "retry").length,
                leadsDiscovered: leadCounts.get(c.id) ?? 0,
                leadsQualified: qualifiedCounts.get(c.id) ?? 0,
                completionPct: campaignJobs.length === 0 ? 0 : Math.round((completeJobs / campaignJobs.length) * 100),
              };
              return (
                <tr key={c.id}>
                  <td>
                    <div>{c.city} — {industryLabels.get(c.industry) ?? c.industry}</div>
                    {c.sourceCommand && <div className="muted" style={{ fontSize: 11 }}>via Manager command</div>}
                  </td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="muted" style={{ fontSize: 11, maxWidth: 180 }}>{c.filters.join(", ") || "—"}</td>
                  <td>{c.priority}</td>
                  <td style={{ minWidth: 160 }}>
                    <div className="progress-bar">
                      <div className="progress-bar-fill" style={{ width: `${progress.completionPct}%` }} />
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                      {progress.completeJobs}/{progress.totalJobs} jobs ({progress.completionPct}%) ·{" "}
                      <Link href={`/queue?campaignId=${c.id}`}>view jobs</Link>
                    </div>
                  </td>
                  <td>{progress.leadsDiscovered}</td>
                  <td>{progress.leadsQualified}</td>
                  <td>
                    <div className="btn-row">
                      {c.status === "draft" && (
                        <ActionButton action={startCampaignAction.bind(null, c.id)} label="Start" />
                      )}
                      {c.status === "running" && (
                        <>
                          <ActionButton action={runNextJobAction.bind(null, c.id)} label="Run Next Job" />
                          <ActionButton action={pauseCampaignAction.bind(null, c.id)} label="Pause" />
                          <ActionButton action={stopCampaignAction.bind(null, c.id)} label="Stop" />
                        </>
                      )}
                      {c.status === "paused" && (
                        <>
                          <ActionButton action={resumeCampaignAction.bind(null, c.id)} label="Resume" />
                          <ActionButton action={stopCampaignAction.bind(null, c.id)} label="Stop" />
                        </>
                      )}
                      {c.status === "stopped" && (
                        <ActionButton action={startCampaignAction.bind(null, c.id)} label="Restart" />
                      )}
                      {c.status === "complete" && <span className="muted" style={{ fontSize: 12 }}>Done</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {campaigns.length === 0 && (
              <tr><td colSpan={8} className="empty-state">No campaigns yet — assign one above or run `npm run seed`.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
