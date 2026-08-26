import { bulkPushAction, type DecodedPushResult } from "../lib/crmActions";

/**
 * The control for filing existing leads into the CRM.
 *
 * Designed around one idea: the destructive-ish button must be harder to reach
 * than the safe one. "Preview" is the primary action and submits plainly;
 * "Push for real" is a separate submit that carries the confirmation value the
 * server insists on. Someone hurrying through this page previews by default.
 */

export interface BulkPushCounts {
  qualified: number;
  highPriority: number;
  alreadyInCrm: number;
}

export function BulkPushPanel({
  counts,
  live,
  result,
  states,
}: {
  counts: BulkPushCounts;
  live: boolean;
  result: DecodedPushResult | null;
  states: { value: string; count: number }[];
}) {
  const eligibleTotal = counts.qualified + counts.highPriority;
  const notYetFiled = Math.max(0, eligibleTotal - counts.alreadyInCrm);

  return (
    <div className="panel">
      <h2>
        Push Existing Leads <small>{notYetFiled.toLocaleString()} not yet in the CRM</small>
      </h2>

      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Campaigns push a lead the moment it qualifies. Leads that arrived any other way — the bulk import, most of
        what you have — were never offered to the CRM. This files them.
      </p>

      <div className="field-grid">
        <div className="field-item">
          <div className="field-label">Qualified</div>
          <div className="field-value">{counts.qualified.toLocaleString()}</div>
        </div>
        <div className="field-item">
          <div className="field-label">High priority</div>
          <div className="field-value">{counts.highPriority.toLocaleString()}</div>
        </div>
        <div className="field-item">
          <div className="field-label">Already filed</div>
          <div className="field-value">{counts.alreadyInCrm.toLocaleString()}</div>
        </div>
        <div className="field-item">
          <div className="field-label">Would be pushed</div>
          <div className="field-value">{notYetFiled.toLocaleString()}</div>
        </div>
      </div>

      {!live && (
        <p className="muted" style={{ fontSize: 12 }}>
          Pipedrive is not connected, so a real push still writes nothing outward — it records what
          <em> would</em> have been sent, and those records are what a later live run updates rather than duplicates.
          Safe to run now; safe to run again once connected.
        </p>
      )}

      {result && <PushResultBanner result={result} />}

      <form action={bulkPushAction} className="bulk-push-form">
        <div className="bulk-push-controls">
          <label className="field-label" htmlFor="batch">
            How many this run
            <input
              id="batch"
              name="batch"
              type="number"
              min={1}
              max={500}
              defaultValue={100}
              className="auth-input"
            />
          </label>

          <label className="field-label" htmlFor="minScore">
            Minimum score
            <input
              id="minScore"
              name="minScore"
              type="number"
              min={0}
              max={100}
              placeholder="any"
              className="auth-input"
            />
          </label>

          <label className="field-label" htmlFor="state">
            State
            <select id="state" name="state" className="auth-input" defaultValue="">
              <option value="">All states</option>
              {states.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.value} ({s.count.toLocaleString()})
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="bulk-push-statuses">
          <legend className="field-label">Include</legend>
          <label>
            <input type="checkbox" name="status" value="HIGH_PRIORITY" defaultChecked /> High priority
          </label>
          <label>
            <input type="checkbox" name="status" value="QUALIFIED" defaultChecked /> Qualified
          </label>
        </fieldset>

        <div className="bulk-push-actions">
          {/* Plain submit — no confirmation value, so the server previews. */}
          <button className="btn btn-primary" type="submit">
            Preview
          </button>
          {/* The only thing that makes the server write. */}
          <button className="btn" type="submit" name="confirm" value="push">
            Push for real
          </button>
        </div>

        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
          Highest-scoring leads go first, so a capped run fills the CRM with the ones worth calling. Anything already
          filed is skipped, and a run that hits the cap tells you how many are left — run it again to continue.
          Capped at 500 per run.
        </p>
      </form>
    </div>
  );
}

function PushResultBanner({ result }: { result: DecodedPushResult }) {
  const tone = result.failureCount > 0 ? "auth-notice" : "auth-notice auth-notice-ok";

  return (
    <div className={tone} style={{ marginBottom: 16 }}>
      <p style={{ margin: 0, fontWeight: 600 }}>
        {result.dryRun ? "Preview — nothing was written" : "Push complete"}
      </p>
      <p style={{ margin: "6px 0 0" }}>{result.summary}</p>

      {result.preview.length > 0 && (
        <>
          <p className="muted" style={{ fontSize: 12, margin: "10px 0 4px" }}>
            {result.dryRun ? "First few that would be created:" : "Sample of what was filed:"}
          </p>
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>City</th>
                <th>Score</th>
                <th>Records</th>
              </tr>
            </thead>
            <tbody>
              {result.preview.map(([name, city, score, objectCount]) => (
                <tr key={`${name}-${city}`}>
                  <td>{name}</td>
                  <td className="muted">{city}</td>
                  <td>{score ?? "—"}</td>
                  <td className="muted">{objectCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {result.failures.length > 0 && (
        <>
          <p style={{ fontSize: 12, margin: "10px 0 4px", fontWeight: 600 }}>
            {result.failureCount} failed{result.failureCount > result.failures.length ? ` (showing ${result.failures.length})` : ""}:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {result.failures.map(([name, error]) => (
              <li key={name}>
                <strong>{name}</strong> — {error}
              </li>
            ))}
          </ul>
          <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
            Failures are safe to retry: pushing is keyed on the lead, so running again picks them back up without
            duplicating anything that succeeded.
          </p>
        </>
      )}
    </div>
  );
}
