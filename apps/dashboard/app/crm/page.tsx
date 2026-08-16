import Link from "next/link";
import { getCrmHandoff, getCrmMode, getPipedriveConfig, getRepos } from "../../lib/data";
import { PayloadPreview } from "../../components/PayloadPreview";

export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const mode = getCrmMode();
  const config = getPipedriveConfig();
  const repos = getRepos();

  // Preview against a real lead — the best-scoring one, since that's the case
  // that produces every object type (organization + person + deal).
  const leads = repos.leads.list({});
  const sample =
    leads.filter((l) => l.qualificationStatus === "HIGH_PRIORITY").sort((a, b) => (b.prospectScore ?? 0) - (a.prospectScore ?? 0))[0] ??
    leads[0];
  const handoff = sample ? getCrmHandoff(sample) : null;

  const mappedCount = config.organization.customFields.filter((f) => f.customFieldKey).length;
  const totalCustom = config.organization.customFields.length;

  return (
    <div>
      <div className="page-header">
        <h1>CRM — Pipedrive</h1>
        <p>
          The adapter is built and wired into the pipeline. It runs in <strong>dry-run</strong> until you connect an
          account, so you can see exactly what would sync before anything leaves this system.
        </p>
      </div>

      <div className="panel">
        <h2>Connection Status</h2>
        <div className="conn-status">
          <span className={mode.live ? "badge badge-running" : "badge badge-draft"}>
            {mode.live ? "LIVE SYNC ON" : "DRY RUN — NOT CONNECTED"}
          </span>
          <p style={{ margin: "10px 0 0" }}>{mode.explanation}</p>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Live sync needs <strong>two</strong> switches, not one: <code>{config.connection.apiTokenEnvVar}</code> must
          hold a token <em>and</em> <code>{config.connection.liveSyncEnvVar}</code> must equal <code>1</code>. A token
          appearing in the environment on its own is never enough to start writing to a real CRM. The public demo
          hard-disables live sync regardless of both.
        </p>
      </div>

      <div className="panel">
        <h2>Turning It On <small>when you buy the membership</small></h2>
        <ol className="setup-steps">
          <li>
            Create the Pipedrive account and add the custom fields listed below to the <strong>Organization</strong>{" "}
            object.
          </li>
          <li>
            Copy each field&apos;s 40-character API key from Pipedrive (Settings → Data fields) into{" "}
            <code>config/crm-pipedrive.json</code>. Fields left as <code>null</code> are skipped on push, never guessed.
          </li>
          <li>
            Create your deal pipeline, then fill in <code>pipelineId</code> and map each internal stage to a Pipedrive
            stage id in the same file.
          </li>
          <li>
            Set <code>{config.connection.apiTokenEnvVar}</code> in the environment.
          </li>
          <li>
            Set <code>{config.connection.liveSyncEnvVar}=1</code> once you&apos;ve confirmed the dry-run payloads below
            look right. That&apos;s the moment it goes live — nothing before it.
          </li>
        </ol>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          No code changes at any step. Everything above is config.
        </p>
      </div>

      <div className="panel">
        <h2>
          What Gets Synced <small>{mappedCount}/{totalCustom} custom fields mapped</small>
        </h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Standard fields work the moment you connect. Custom fields carry the research this system produces — the part
          a generic CRM has no column for — and need a key from your account first.
        </p>
        <table>
          <thead>
            <tr>
              <th>Lead field</th>
              <th>Pipedrive field</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {config.organization.standardFields.map((f) => (
              <tr key={f.pipedriveField}>
                <td>{f.leadField}</td>
                <td className="muted">{f.pipedriveField}</td>
                <td className="muted">standard</td>
                <td>
                  <span className="badge badge-complete">Ready</span>
                </td>
              </tr>
            ))}
            {config.organization.customFields.map((f) => (
              <tr key={f.leadField}>
                <td>{f.leadField}</td>
                <td className="muted">{f.label}</td>
                <td className="muted">{f.type}</td>
                <td>
                  {f.customFieldKey ? (
                    <span className="badge badge-complete">Mapped</span>
                  ) : (
                    <span className="badge badge-draft">Needs key</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Sync Rules</h2>
          <div className="field-grid">
            <div className="field-item">
              <div className="field-label">Organization</div>
              <div className="field-value">Created for every lead pushed</div>
            </div>
            <div className="field-item">
              <div className="field-label">Person</div>
              <div className="field-value">Only when a phone or email exists</div>
            </div>
            <div className="field-item">
              <div className="field-label">Deal</div>
              <div className="field-value">Only for QUALIFIED or HIGH_PRIORITY</div>
            </div>
            <div className="field-item">
              <div className="field-label">Deal value</div>
              <div className="field-value">Never sent</div>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            The Person rule matters more than it looks: your best-scoring leads are often the ones with no web presence,
            so a contactless business still gets an Organization record rather than being dropped.
          </p>
        </div>

        <div className="panel">
          <h2>Deal Stage Mapping</h2>
          <table>
            <thead>
              <tr>
                <th>Internal stage</th>
                <th>Pipedrive stage id</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(config.deal.stageMap).map(([stage, id]) => (
                <tr key={stage}>
                  <td>{stage.replace(/_/g, " ")}</td>
                  <td className={id == null ? "muted" : undefined}>{id ?? "not mapped"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Unmapped stages are skipped rather than defaulting to stage 1 — a wrong stage is worse than no stage.
          </p>
        </div>
      </div>

      {handoff && sample && (
        <div className="panel">
          <h2>
            Live Payload Preview <small>real lead, real mapping, nothing sent</small>
          </h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Generated right now from{" "}
            <Link href={`/leads/${sample.id}`}>{sample.businessName}</Link> (score {sample.prospectScore ?? "—"},{" "}
            {sample.qualificationStatus.replace(/_/g, " ")}). This is the actual HTTP request body the adapter would
            send.
          </p>
          <PayloadPreview handoff={handoff} baseUrl={config.connection.apiBaseUrl} />
        </div>
      )}
    </div>
  );
}
