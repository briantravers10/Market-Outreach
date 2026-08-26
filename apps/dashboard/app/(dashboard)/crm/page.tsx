import Link from "next/link";
import { getCrmHandoff, getCrmMode, getPipedriveConfig, getRepos } from "../../../lib/data";
import { PayloadPreview } from "../../../components/PayloadPreview";
import { BulkPushPanel } from "../../../components/BulkPushPanel";
import { decodePushResult } from "../../../lib/crmActions";

export const dynamic = "force-dynamic";

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const mode = getCrmMode();
  const config = getPipedriveConfig();
  const repos = getRepos();
  const { result: rawResult } = await searchParams;
  const pushResult = await decodePushResult(rawResult);

  // Counts come from SQL aggregates, never by listing leads — this page is one
  // of the ones that was pulling the whole table to render a few tiles.
  const [qualified, highPriority, syncedIds, stateGroups] = await Promise.all([
    repos.leads.count({ qualificationStatus: "QUALIFIED", isDuplicate: false }),
    repos.leads.count({ qualificationStatus: "HIGH_PRIORITY", isDuplicate: false }),
    repos.crm.syncedLeadIds(),
    repos.leads.groupCount("state", { isDuplicate: false }),
  ]);

  const counts = { qualified, highPriority, alreadyInCrm: syncedIds.length };
  const states = stateGroups
    .filter((g) => g.value)
    .map((g) => ({ value: String(g.value), count: g.count }))
    .sort((a, b) => b.count - a.count);

  // Preview against a real lead — the best-scoring one, since that's the case
  // that produces every object type (organization + person + deal).
  // The best-scoring lead, asked for as such. This used to pull every lead and
  // sort in memory, which was harmless at a thousand rows and is not at
  // seventy-seven thousand.
  const sample =
    (await repos.leads.list({ qualificationStatus: "HIGH_PRIORITY", orderBy: "score", limit: 1 }))[0] ??
    (await repos.leads.list({ orderBy: "score", limit: 1 }))[0];
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
        <h2>Turning It On <small>four steps, no hand-copied keys</small></h2>
        <ol className="setup-steps">
          <li>
            Create the Pipedrive account and generate an API token (Settings → Personal preferences → API).
          </li>
          <li>
            Run <code>npm run setup-crm</code> with that token. It verifies the token, creates the custom fields
            listed below, reads back the 40-character keys Pipedrive assigns, writes them into{" "}
            <code>config/crm-pipedrive.json</code>, and maps your deal pipeline and stages. Safe to re-run — it
            matches fields by name, so a second run creates nothing and just refreshes the keys. It only ever adds,
            and never touches your organizations, people or deals.
          </li>
          <li>
            Set <code>{config.connection.apiTokenEnvVar}</code> in the environment, then check the payload preview at
            the bottom of this page.
          </li>
          <li>
            Set <code>{config.connection.liveSyncEnvVar}=1</code> once those payloads look right. That&apos;s the
            moment it goes live — nothing before it.
          </li>
        </ol>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          No code changes at any step. Fields the account has no key for are skipped on push, never guessed — so a
          partial setup under-sends rather than writing to the wrong column.
        </p>
      </div>

      <BulkPushPanel
        counts={counts}
        live={mode.live}
        result={pushResult}
        states={states}
      />

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
