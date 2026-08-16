import type { PipedriveHandoff } from "@market-outreach/core";

/**
 * Renders the exact request bodies the Pipedrive adapter would send for a
 * lead, plus everything it deliberately leaves out and why. Server component —
 * the payloads are built by a pure function, so no credentials are involved.
 */
export function PayloadPreview({ handoff, baseUrl }: { handoff: PipedriveHandoff; baseUrl: string }) {
  return (
    <div>
      {handoff.payloads.map((payload) => (
        <div key={payload.object} className="payload-block">
          <div className="payload-head">
            <span className="payload-method">{payload.method}</span>
            <code>
              {baseUrl}
              {payload.endpoint}
            </code>
            <span className="payload-object">{payload.object}</span>
          </div>
          <pre className="payload-body">{JSON.stringify(payload.body, null, 2)}</pre>
          {payload.skipped.length > 0 && (
            <details className="payload-skipped">
              <summary>
                {payload.skipped.length} field{payload.skipped.length === 1 ? "" : "s"} not included
              </summary>
              <table>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.skipped.map((s) => (
                    <tr key={`${s.leadField}-${s.label}`}>
                      <td>{s.label}</td>
                      <td className="muted">{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      ))}

      {handoff.notes.map((note) => (
        <p key={note} className="payload-note">
          {note}
        </p>
      ))}
    </div>
  );
}
