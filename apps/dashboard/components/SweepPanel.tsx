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
}: {
  neverChecked: number;
  needsRecheck: number;
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

      <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
        This runs on its own every ten minutes and needs nothing from you. There is deliberately no button: a queue
        this size is not something to work through by hand, and a manual control would only ever leave half the
        database judged by one method and half by another. Leads move into the working list as they finish.
      </p>
    </div>
  );
}

