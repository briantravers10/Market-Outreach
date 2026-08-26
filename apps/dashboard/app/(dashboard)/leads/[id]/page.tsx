import Link from "next/link";
import { notFound } from "next/navigation";
import { getIndustries } from "@market-outreach/core";
import { getCrmHandoff, getCrmMode, getPipedriveConfig, getRepos } from "../../../../lib/data";
import { AddToCrmPanel } from "../../../../components/AddToCrmPanel";
import { ConfidenceBadge, QualificationBadge, ScorePill } from "../../../../components/Badges";
import { PipelineChecklist } from "../../../../components/PipelineChecklist";
import { PayloadPreview } from "../../../../components/PayloadPreview";
import { LinkInBio } from "../../../../components/LinkInBio";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repos = getRepos();
  const lead = await repos.leads.getById(id);
  if (!lead) notFound();

  const industryLabel = getIndustries().find((i) => i.id === lead.industry)?.label ?? lead.industry;
  const crmRecords = await repos.crm.listByLead(lead.id);
  const duplicateOf = lead.isDuplicateOf ? await repos.leads.getById(lead.isDuplicateOf) : null;
  const scoreHistory = await repos.scoreResults.listByLead(lead.id);
  const latestScore = scoreHistory[0] ?? null;
  const activity = await repos.agentActivity.list({ leadId: lead.id, limit: 20 });
  const crmMode = getCrmMode();
  const crmHandoff = getCrmHandoff(lead);
  const pipedriveConfig = getPipedriveConfig();

  return (
    <div>
      <div className="page-header">
        <p><Link href="/leads" className="muted">← Back to Leads</Link></p>
        <h1>{lead.businessName}</h1>
        <p>{industryLabel} · {lead.city}, {lead.state} {lead.zip}</p>
      </div>

      <AddToCrmPanel
        leadId={lead.id}
        businessName={lead.businessName}
        alreadyInCrm={crmRecords.length > 0}
        dealId={crmRecords.find((r) => r.externalDealId)?.externalDealId ?? null}
        live={crmMode.live}
      />

      <div className="panel">
        <h2>Pipeline</h2>
        <PipelineChecklist completed={lead.stagesCompleted} />
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Business Information</h2>
          <div className="field-grid">
            <Field
              label="Address"
              value={lead.address ? `${lead.address}, ${lead.city}, ${lead.state} ${lead.zip}` : "No fixed address (mobile)"}
            />
            <Field label="Service Area" value={lead.serviceArea ?? (lead.address ? "—" : "UNKNOWN")} />
            <Field label="Phone" value={lead.phone ?? "UNKNOWN"} />
            <Field label="Email" value={lead.email ?? "UNKNOWN"} />
            <Field label="Website" value={lead.website ?? "UNKNOWN"} />
            <Field label="Services" value={lead.services.length ? lead.services.join(", ") : "UNKNOWN"} />
          </div>
        </div>

        <div className="panel">
          <h2>Location Confidence</h2>
          <div style={{ marginBottom: 8 }}>
            <ConfidenceBadge level={lead.locationConfidence} />
          </div>
          {lead.locationEvidence.length === 0 ? (
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>No location signals recorded.</p>
          ) : (
            <ul className="evidence-list">
              {lead.locationEvidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <p className="muted" style={{ fontSize: 11 }}>
            Separate from data confidence: a mobile artist with a well-evidenced service area is located, not
            under-researched.
          </p>

          <h2 style={{ marginTop: 18 }}>Website Analysis</h2>
          <div className="field-grid">
            <Field label="Website Status" value={lead.websiteStatus === "NONE" ? "No Website" : "Exists"} />
            <Field label="Website Quality" value={lead.websiteQuality} />
          </div>

          <h2 style={{ marginTop: 18 }}>Booking Analysis</h2>
          <div className="field-grid">
            <Field label="Online Booking Status" value={lead.onlineBookingStatus.replace(/_/g, " ")} />
            <Field label="Booking Method" value={lead.bookingMethod.replace(/_/g, " ")} />
            <Field label="Booking Provider" value={lead.bookingProvider ?? "—"} />
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Link in Bio <small>what they actually link to</small></h2>
          <LinkInBio url={lead.linkInBioUrl} links={lead.detectedLinks} />
        </div>

        <div className="panel">
          <h2>Social Information</h2>
          <div className="field-grid">
            <Field label="Instagram" value={lead.instagram ?? "UNKNOWN"} />
            <Field label="Facebook" value={lead.facebook ?? "UNKNOWN"} />
            <Field label="Social Activity" value={lead.socialActivity} />
          </div>
        </div>

        <div className="panel">
          <h2>Business Size / Activity</h2>
          <div className="field-grid">
            <Field label="Staff Count" value={lead.staffCount !== null ? String(lead.staffCount) : "UNKNOWN"} />
            <Field label="Staff Count Confidence" value={lead.staffCountConfidence} />
            <Field label="Locations" value={String(lead.locationCount ?? "UNKNOWN")} />
            <Field label="Rating" value={lead.rating !== null ? `${lead.rating} (${lead.reviewCount} reviews)` : "UNKNOWN"} />
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Prospect Score <small>WEBSITE + INTEGRATED BOOKING fit</small></h2>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
            <ScorePill score={lead.prospectScore} />
            <QualificationBadge status={lead.qualificationStatus} />
          </div>

          <h2 style={{ marginTop: 18 }}>Score Breakdown</h2>
          {lead.scoreBreakdown.length === 0 && <p className="empty-state">Not yet scored.</p>}
          {lead.scoreBreakdown.map((factor) => (
            <div className="factor-row" key={factor.id}>
              <div>
                <div>{factor.label}</div>
                <div className="muted" style={{ fontSize: 12 }}>{factor.reason}</div>
              </div>
              <div className={`factor-points ${factor.points > 0 ? "positive" : "negative"}`}>
                {factor.points > 0 ? "+" : ""}{factor.points}
              </div>
            </div>
          ))}

          <h2 style={{ marginTop: 18 }}>Score Explanation</h2>
          <p className="muted" style={{ marginTop: 0 }}>{lead.scoreReason ?? "Not yet scored."}</p>

          {duplicateOf && (
            <p className="disabled-banner" style={{ marginTop: 14 }}>
              Flagged as a likely duplicate of <Link href={`/leads/${duplicateOf.id}`}>{duplicateOf.businessName}</Link>.
            </p>
          )}
        </div>

        <div className="panel">
          <h2>Data Confidence</h2>
          <div style={{ marginBottom: 8 }}>
            <ConfidenceBadge level={lead.dataConfidence} />
          </div>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            {latestScore?.confidenceReason ?? "Not yet evaluated."}
          </p>
          <p className="muted" style={{ fontSize: 11 }}>
            Independent of prospect score — see config/scoring-config.json for how each is calculated.
          </p>

          <h2 style={{ marginTop: 18 }}>Research Sources</h2>
          <div className="field-grid">
            <Field label="Discovery Source" value={lead.discoverySource} />
            <Field label="Date Discovered" value={new Date(lead.dateDiscovered).toLocaleString()} />
            <Field label="Date Last Researched" value={lead.dateLastResearched ? new Date(lead.dateLastResearched).toLocaleString() : "—"} />
            <Field label="Campaign / Job" value={`${lead.campaignId.slice(0, 8)}… / ${lead.jobId.slice(0, 8)}…`} />
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Agent Activity</h2>
          {activity.length === 0 ? (
            <p className="empty-state">No activity recorded.</p>
          ) : (
            activity.map((a) => (
              <div className="activity-row" key={a.id}>
                <span className="activity-time">{new Date(a.createdAt).toLocaleTimeString()}</span>
                <span className={`activity-summary level-${a.level}`}>{a.summary}</span>
              </div>
            ))
          )}

          <h2 style={{ marginTop: 18 }}>Notes</h2>
          <p className="muted">{lead.notes || "—"}</p>
        </div>

        <div className="panel">
          <h2>
            CRM Hand-off <small>Pipedrive · {crmMode.live ? "LIVE" : "dry run"}</small>
          </h2>
          <p className={crmMode.live ? "muted" : "disabled-banner"}>{crmMode.explanation}</p>

          {crmRecords.length > 0 && (
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Stage</th><th>Synced</th><th>CRM</th></tr></thead>
              <tbody>
                {crmRecords.map((r) => (
                  <tr key={r.id}>
                    <td>{r.stage.replace(/_/g, " ")}</td>
                    <td className="muted">{new Date(r.syncedAt).toLocaleString()}</td>
                    <td className="muted">{r.externalCrmName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Exactly what would be sent to Pipedrive for this lead — see <Link href="/crm">CRM settings</Link> for the
            full field mapping.
          </p>
          <PayloadPreview handoff={crmHandoff} baseUrl={pipedriveConfig.connection.apiBaseUrl} />

          <h2 style={{ marginTop: 18 }}>Future Outreach <small>status: DISABLED</small></h2>
          <p className="disabled-banner">No Outreach Agent is active this phase — this system never sends email or SMS.</p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field-item">
      <div className="field-label">{label}</div>
      <div className="field-value">{value}</div>
    </div>
  );
}
