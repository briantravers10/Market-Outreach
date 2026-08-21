import Link from "next/link";
import { getAgentConfigs, getIndustries, getScoringConfig, getTerritories } from "@market-outreach/core";
import { getCrmMode } from "../../../lib/data";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const scoring = getScoringConfig();
  const territories = getTerritories();
  const industries = getIndustries();
  const agents = getAgentConfigs();
  const crmMode = getCrmMode();

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
        <p>Everything here is config-driven, not buried in agent prompts — edit the JSON files under <code>config/</code> to change behavior.</p>
      </div>

      <div className="panel">
        <h2>Scoring Weights <small>config/scoring-config.json</small></h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Base score: <strong>{scoring.baseScore}</strong>. Range: {scoring.scoreRange.min}–{scoring.scoreRange.max}.
        </p>
        <table>
          <thead><tr><th>Factor</th><th>Category</th><th>Points</th><th>Enabled</th></tr></thead>
          <tbody>
            {scoring.factors.map((f) => (
              <tr key={f.id}>
                <td>{f.label}</td>
                <td className="muted">{f.category}</td>
                <td className={f.points >= 0 ? "factor-points positive" : "factor-points negative"}>
                  {f.points > 0 ? "+" : ""}{f.points}
                </td>
                <td className="muted">{f.enabled ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          This phase, edit the weights by hand-editing <code>config/scoring-config.json</code> and redeploying — an in-dashboard editor is a clean follow-on, not core architecture.
        </p>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Qualification Thresholds</h2>
          <div className="field-grid">
            <div className="field-item">
              <div className="field-label">High Priority</div>
              <div className="field-value">{scoring.qualification.highPriorityMin}+</div>
            </div>
            <div className="field-item">
              <div className="field-label">Qualified</div>
              <div className="field-value">{scoring.qualification.qualifiedMin}+</div>
            </div>
            <div className="field-item">
              <div className="field-label">Disqualified</div>
              <div className="field-value">{scoring.qualification.disqualifiedMax} or below</div>
            </div>
          </div>
        </div>

        <div className="panel">
          <h2>Data Confidence Thresholds</h2>
          <div className="field-grid">
            <div className="field-item">
              <div className="field-label">High</div>
              <div className="field-value">{Math.round(scoring.confidence.thresholds.high * 100)}%+ fields resolved</div>
            </div>
            <div className="field-item">
              <div className="field-label">Medium</div>
              <div className="field-value">{Math.round(scoring.confidence.thresholds.medium * 100)}%+ fields resolved</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Territories <small>config/territories.json</small></h2>
          <table>
            <thead><tr><th>City</th><th>State</th><th>Active</th></tr></thead>
            <tbody>
              {territories.map((t) => (
                <tr key={t.id}><td>{t.city}</td><td>{t.state}</td><td className="muted">{t.active ? "Yes" : "No"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Industries <small>config/industries.json</small></h2>
          <table>
            <thead><tr><th>Industry</th><th>Active</th></tr></thead>
            <tbody>
              {industries.map((i) => (
                <tr key={i.id}><td>{i.label}</td><td className="muted">{i.active ? "Yes" : "No"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>Agent Roster <small>config/agents.json</small></h2>
        <table>
          <thead><tr><th>Agent</th><th>Role</th><th>Status</th></tr></thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td className="muted">{a.role}</td>
                <td>{a.disabled ? <span className="disabled-banner" style={{ display: "inline-block", padding: "2px 8px" }}>Disabled</span> : "Active"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>CRM <small>Pipedrive · {crmMode.live ? "LIVE" : "dry run"}</small></h2>
          <p className={crmMode.live ? "muted" : "disabled-banner"}>{crmMode.explanation}</p>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Field mapping and the exact payloads live on the <Link href="/crm">CRM page</Link>; edit{" "}
            <code>config/crm-pipedrive.json</code> to change what syncs.
          </p>
        </div>
        <div className="panel">
          <h2>Outreach <small>status: DISABLED</small></h2>
          <p className="disabled-banner">No email/SMS provider is wired up. This system never sends outreach — Resend/Twilio are not installed as dependencies.</p>
        </div>
      </div>
    </div>
  );
}
