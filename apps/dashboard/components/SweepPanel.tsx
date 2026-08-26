import { runSweepAction, type SweepOutcome } from "../lib/sweepActions";

/**
 * Running the website sweep by hand.
 *
 * Two queues, shown as two counts, because they answer different questions.
 * "Never read" drains on its own from the schedule. "Worth re-reading" only
 * ever fills when the analysis improves, and draining it is a decision — so it
 * gets a button rather than a cron entry.
 */
export function SweepPanel({
  neverChecked,
  needsRecheck,
  outcome,
}: {
  neverChecked: number;
  needsRecheck: number;
  outcome: SweepOutcome | null;
}) {
  return (
    <div className="panel">
      <h2>
        Website Sweep <small>read sites and re-score</small>
      </h2>

      <div className="field-grid">
        <div className="field-item">
          <div className="field-label">Never read</div>
          <div className="field-value">{neverChecked.toLocaleString()}</div>
        </div>
        <div className="field-item">
          <div className="field-label">Worth re-reading</div>
          <div className="field-value">{needsRecheck.toLocaleString()}</div>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12.5 }}>
        <strong>Worth re-reading</strong> is every lead the older analysis decided: sites that did not answer on a
        single URL form, and sites marked &ldquo;no online booking&rdquo; before inner pages were being read. Both
        answers can change now, and the booking one is the highest-weighted field in the score.
      </p>

      {outcome && <SweepResult outcome={outcome} />}

      <form action={runSweepAction} className="bulk-push-actions">
        <button className="btn btn-primary" type="submit" name="mode" value="recheck">
          Re-read a batch
        </button>
        <button className="btn" type="submit" name="mode" value="new">
          Read unchecked
        </button>
      </form>

      <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
        A batch is bounded by a 20-second budget, so this returns while you wait rather than timing out — expect
        roughly a hundred sites a click. Whatever it does not reach stays queued. The hourly schedule works the same
        queues with a much longer budget, so the fastest route through tens of thousands is to leave it running.
      </p>
    </div>
  );
}

function SweepResult({ outcome }: { outcome: SweepOutcome }) {
  if (outcome.checked === 0) {
    return (
      <div className="auth-notice auth-notice-ok" style={{ marginBottom: 14 }}>
        <p style={{ margin: 0 }}>
          Nothing left in the {outcome.mode === "recheck" ? "re-read" : "unchecked"} queue.
        </p>
      </div>
    );
  }

  return (
    <div className="auth-notice auth-notice-ok" style={{ marginBottom: 14 }}>
      <p style={{ margin: 0, fontWeight: 600 }}>
        Read {outcome.checked.toLocaleString()} site{outcome.checked === 1 ? "" : "s"}
        {outcome.mode === "recheck" ? " again" : ""}.
      </p>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
        <li>{outcome.reachable.toLocaleString()} answered, {outcome.unreachable.toLocaleString()} did not</li>
        <li>{outcome.bookingFound.toLocaleString()} have online booking</li>
        <li>{outcome.scoreImproved.toLocaleString()} changed score</li>
        <li>{outcome.remaining.toLocaleString()} still queued</li>
      </ul>
    </div>
  );
}
