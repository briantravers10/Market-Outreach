import Link from "next/link";
import { getRepos } from "../../../../lib/data";

export const dynamic = "force-dynamic";

/** Report archive, grouped by type. Selecting one shows it in full. */
export default async function ReportsArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const repos = getRepos();
  const reports = await repos.reports.list({ limit: 200 });
  const selected = id ? await repos.reports.getById(id) : null;

  const groups: { label: string; items: typeof reports }[] = [
    { label: "Daily", items: reports.filter((r) => r.type === "daily") },
    { label: "Weekly", items: reports.filter((r) => r.type === "weekly") },
    { label: "Briefings", items: reports.filter((r) => r.type === "briefing") },
    { label: "Other", items: reports.filter((r) => r.type === "custom") },
  ].filter((g) => g.items.length > 0);

  if (reports.length === 0) {
    return (
      <div className="panel">
        <p className="empty-state">
          The archive is empty. Ask the Manager for your briefing or a report and it will be saved here
          automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="grid-2">
      <div>
        {groups.map((group) => (
          <div className="panel" key={group.label}>
            <h2>{group.label} <small>({group.items.length})</small></h2>
            {group.items.map((r) => (
              <div className="activity-row" key={r.id}>
                <Link href={`/manager/reports?id=${r.id}`}>{r.title}</Link>
                <span className="activity-time">
                  {new Date(r.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="panel">
        {selected ? (
          <>
            <h2>{selected.title}</h2>
            <p className="muted" style={{ fontSize: 12.5 }}>
              Covers {new Date(selected.periodStart).toLocaleString("en-GB")} to{" "}
              {new Date(selected.periodEnd).toLocaleString("en-GB")} · generated{" "}
              {new Date(selected.generatedAt).toLocaleString("en-GB")} by {selected.generatedBy}
            </p>
            <div style={{ margin: "14px 0", fontSize: 14, lineHeight: 1.6 }}>
              {selected.summary.split("\n").map((line, i) => (
                <p key={i} style={{ margin: "0 0 6px" }}>{line}</p>
              ))}
            </div>

            <h2 style={{ marginTop: 20 }}>The numbers behind it</h2>
            <table>
              <tbody>
                <tr><td>Businesses discovered</td><td>{selected.metrics.businessesDiscovered}</td></tr>
                <tr><td>Researched</td><td>{selected.metrics.businessesResearched}</td></tr>
                <tr><td>Analyzed</td><td>{selected.metrics.businessesAnalyzed}</td></tr>
                <tr><td>Qualified</td><td>{selected.metrics.qualifiedLeads}</td></tr>
                <tr><td>High priority</td><td>{selected.metrics.highPriorityLeads}</td></tr>
                <tr><td>Rejected</td><td>{selected.metrics.rejectedLeads}</td></tr>
                <tr><td>Duplicates removed</td><td>{selected.metrics.duplicatesRemoved}</td></tr>
                <tr><td>Jobs completed</td><td>{selected.metrics.jobsCompleted}</td></tr>
                <tr><td>Jobs failed</td><td>{selected.metrics.jobsFailed}</td></tr>
                <tr><td>Awaiting review</td><td>{selected.metrics.openHumanReviewItems}</td></tr>
                <tr><td>Average score</td><td>{selected.metrics.averageScore ?? "—"}</td></tr>
                <tr><td>Instructions changed</td><td>{selected.metrics.instructionsChanged}</td></tr>
              </tbody>
            </table>

            {selected.metrics.topLeads.length > 0 && (
              <>
                <h2 style={{ marginTop: 20 }}>Top opportunities at the time</h2>
                <table>
                  <thead><tr><th>Business</th><th>City</th><th>Score</th></tr></thead>
                  <tbody>
                    {selected.metrics.topLeads.map((l) => (
                      <tr key={l.id}>
                        <td><Link href={`/leads/${l.id}`}>{l.businessName}</Link></td>
                        <td>{l.city}</td>
                        <td>{l.score ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        ) : (
          <p className="empty-state">Select a report to read it.</p>
        )}
      </div>
    </div>
  );
}
