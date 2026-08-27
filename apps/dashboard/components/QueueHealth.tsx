/**
 * Whether the research is actually moving, as opposed to merely running.
 *
 * This panel exists because of a specific failure. The website re-check queue
 * spun on the same 800 leads for about thirteen hours — the cron fired every
 * five minutes, logged "checked 800" every time, and the agent showed as
 * Working throughout. Thirty-nine thousand leads behind those 800 never moved,
 * and nothing on the dashboard could have told you.
 *
 * The signature is a pair of numbers, which is why both are shown: plenty in
 * the queue, almost nothing DISTINCT coming out of it. A spinning queue
 * rewrites the same rows, so a count of work done looks healthy; a count of
 * distinct leads that carry a recent stamp cannot be faked that way.
 */
export interface QueueRow {
  name: string;
  queued: number;
  movedLastHour: number;
  detail: string;
}

function verdict(row: QueueRow): { label: string; tone: "good" | "idle" | "stuck" } {
  if (row.queued === 0) return { label: "Nothing waiting", tone: "good" };
  if (row.movedLastHour === 0) return { label: "Not moving", tone: "stuck" };
  // A queue that is running but barely touching new leads is the shape of the
  // spin. The threshold is deliberately loose: this is a smell, not a verdict.
  if (row.movedLastHour < Math.min(50, row.queued * 0.01)) return { label: "Barely moving", tone: "idle" };
  return { label: "Moving", tone: "good" };
}

function hoursLeft(row: QueueRow): string | null {
  if (row.queued === 0 || row.movedLastHour === 0) return null;
  const hours = row.queued / row.movedLastHour;
  if (hours < 1) return "under an hour left";
  if (hours < 48) return `about ${Math.round(hours)} hours left at this rate`;
  return `about ${Math.round(hours / 24)} days left at this rate`;
}

export function QueueHealth({ rows }: { rows: QueueRow[] }) {
  return (
    <div className="panel">
      <h2>
        Research queues <small>last hour</small>
      </h2>
      <div className="queue-health">
        {rows.map((row) => {
          const state = verdict(row);
          const eta = hoursLeft(row);
          return (
            <div key={row.name} className="queue-row">
              <div className="queue-row-head">
                <strong>{row.name}</strong>
                <span className={`queue-badge queue-badge-${state.tone}`}>{state.label}</span>
              </div>
              <div className="queue-row-figures">
                <span>
                  <b>{row.queued.toLocaleString()}</b> waiting
                </span>
                <span>
                  <b>{row.movedLastHour.toLocaleString()}</b> finished in the last hour
                </span>
              </div>
              <p className="muted">
                {row.detail}
                {eta ? ` — ${eta}.` : ""}
              </p>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        The second number counts <em>distinct businesses</em> finished, not jobs run. That distinction is the whole
        point: a queue re-reading the same rows forever reports plenty of work done, and only the distinct count
        gives it away. A queue with plenty waiting and almost nothing finished is stuck, however busy it looks
        elsewhere.
      </p>
    </div>
  );
}
