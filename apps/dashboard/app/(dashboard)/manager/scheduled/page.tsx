import { getRepos } from "../../../../lib/data";

export const dynamic = "force-dynamic";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Scheduled reports.
 *
 * States plainly whether the scheduler is actually wired up on this deployment,
 * because a schedule row that nothing ever fires would look identical to one
 * that works.
 */
export default async function ScheduledPage() {
  const repos = getRepos();
  const tasks = await repos.scheduledTasks.list({});
  const cronConfigured = Boolean(process.env.CRON_SECRET?.trim());

  return (
    <div>
      <div className="panel">
        <h2>Scheduler status</h2>
        {cronConfigured ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Wired up. A scheduled job calls <code>/api/cron/run-scheduled</code>, which runs anything due
            and archives the result.
          </p>
        ) : (
          <div className="notice-banner notice-clarify">
            <strong>Not yet running.</strong> Schedules below are stored, but nothing fires them until
            <code> CRON_SECRET</code> is set and Vercel Cron is enabled. See NEEDS_OWNER_INPUT.md — this is
            two settings, not a code change.
          </div>
        )}
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          Times are treated as UTC. Timezone support isn&apos;t implemented yet, so a 9am schedule fires at
          09:00 UTC rather than 9am local.
        </p>
      </div>

      <div className="panel">
        <h2>Schedules <small>({tasks.length})</small></h2>
        {tasks.length === 0 ? (
          <p className="empty-state">
            Nothing scheduled. Tell the Manager &ldquo;every morning at 9 give me a progress report
            covering yesterday&rdquo;.
          </p>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>When</th><th>Next run</th><th>Last run</th><th>Status</th></tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.name}
                    <div className="muted" style={{ fontSize: 11.5 }}>&ldquo;{t.instruction}&rdquo;</div>
                  </td>
                  <td>
                    {t.dayOfWeek === null
                      ? `Daily at ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`
                      : `${DAYS[t.dayOfWeek]}s at ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`}
                  </td>
                  <td>{t.nextRunAt ? new Date(t.nextRunAt).toLocaleString("en-GB") : "—"}</td>
                  <td>{t.lastRunAt ? new Date(t.lastRunAt).toLocaleString("en-GB") : "Never"}</td>
                  <td>
                    <span className={`tag ${t.active ? "tag-enforced" : "tag-inactive"}`}>
                      {t.active ? "Active" : "Paused"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
