import { getIndustries, getTerritories, type JobStatus } from "@market-outreach/core";
import { getRepos } from "../../lib/data";
import { StatusBadge } from "../../components/Badges";
import { requeueJobAction } from "../../lib/actions";

const STATUSES: JobStatus[] = ["pending", "running", "complete", "failed", "retry", "human_review", "paused"];

export const dynamic = "force-dynamic";

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string; industry?: string; status?: string }>;
}) {
  const params = await searchParams;
  const repos = getRepos();
  const territories = getTerritories();
  const industries = getIndustries();
  const industryLabels = new Map(industries.map((i) => [i.id, i.label]));

  const jobs = repos.jobs.list({
    city: params.city || undefined,
    industry: params.industry || undefined,
    status: (params.status as JobStatus) || undefined,
  });
  const campaigns = new Map(repos.campaigns.list().map((c) => [c.id, c]));

  const statusCounts = STATUSES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = repos.jobs.list({ status: s }).length;
    return acc;
  }, {});

  return (
    <div>
      <div className="page-header">
        <h1>Work Queue</h1>
        <p>City + Industry + Batch jobs. Resumable — a job's status and checkpoint payload survive restarts.</p>
      </div>

      <div className="kpi-grid">
        {STATUSES.map((s) => (
          <KpiMini key={s} status={s} count={statusCounts[s]} />
        ))}
      </div>

      <form className="filter-bar" method="get">
        <div className="filter-field">
          <label>City</label>
          <select name="city" defaultValue={params.city || ""}>
            <option value="">All</option>
            {territories.map((t) => (
              <option key={t.id} value={t.city}>{t.city}</option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label>Industry</label>
          <select name="industry" defaultValue={params.industry || ""}>
            <option value="">All</option>
            {industries.map((i) => (
              <option key={i.id} value={i.id}>{i.label}</option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label>Status</label>
          <select name="status" defaultValue={params.status || ""}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <button className="btn btn-secondary" type="submit">Apply Filters</button>
      </form>

      <div className="panel">
        <h2>Jobs <small>({jobs.length})</small></h2>
        <table>
          <thead>
            <tr>
              <th>City</th>
              <th>Industry</th>
              <th>Batch</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Campaign</th>
              <th>Updated</th>
              <th>Error</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.city}</td>
                <td>{industryLabels.get(job.industry) ?? job.industry}</td>
                <td>{job.batchId}</td>
                <td><StatusBadge status={job.status} /></td>
                <td>{job.attempts}</td>
                <td className="muted">{campaigns.get(job.campaignId)?.name ?? "—"}</td>
                <td className="muted">{new Date(job.updatedAt).toLocaleString()}</td>
                <td className="muted">{job.error ?? "—"}</td>
                <td>
                  {(job.status === "failed" || job.status === "retry") && (
                    <form action={requeueJobAction.bind(null, job.id)}>
                      <button className="btn-ghost" type="submit">Requeue</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr><td colSpan={9} className="empty-state">No jobs match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiMini({ status, count }: { status: string; count: number }) {
  return (
    <div className="kpi-tile">
      <div className="value">{count}</div>
      <div className="label"><StatusBadge status={status} /></div>
    </div>
  );
}
