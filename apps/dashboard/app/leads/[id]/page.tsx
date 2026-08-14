import Link from "next/link";
import { notFound } from "next/navigation";
import { getIndustries } from "@market-outreach/core";
import { getRepos } from "../../../lib/data";
import { ConfidenceBadge, QualificationBadge, ScorePill, StatusBadge } from "../../../components/Badges";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repos = getRepos();
  const lead = repos.leads.getById(id);
  if (!lead) notFound();

  const industryLabel = getIndustries().find((i) => i.id === lead.industry)?.label ?? lead.industry;
  const crmRecords = repos.crm.listByLead(lead.id);
  const duplicateOf = lead.isDuplicateOf ? repos.leads.getById(lead.isDuplicateOf) : null;

  return (
    <div>
      <div className="page-header">
        <p><Link href="/leads" className="muted">← Back to Leads</Link></p>
        <h1>{lead.businessName}</h1>
        <p>{industryLabel} · {lead.city}, {lead.state} {lead.zip}</p>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Business Info</h2>
          <div className="field-grid">
            <Field label="Address" value={`${lead.address}, ${lead.city}, ${lead.state} ${lead.zip}`} />
            <Field label="Phone" value={lead.phone ?? "—"} />
            <Field label="Email" value={lead.email ?? "—"} />
            <Field label="Website" value={lead.website ?? "—"} />
            <Field label="Services" value={lead.services.length ? lead.services.join(", ") : "—"} />
            <Field label="Locations" value={String(lead.locationCount ?? "—")} />
            <Field label="Instagram" value={lead.instagram ?? "—"} />
            <Field label="Facebook" value={lead.facebook ?? "—"} />
            <Field label="Social Activity" value={lead.socialActivity} />
          </div>
        </div>

        <div className="panel">
          <h2>Digital / Booking Analysis</h2>
          <div className="field-grid">
            <Field label="Website Status" value={lead.websiteStatus === "NONE" ? "No Website" : "Exists"} />
            <Field label="Website Quality" value={lead.websiteQuality} />
            <Field label="Online Booking Status" value={lead.onlineBookingStatus.replace(/_/g, " ")} />
            <Field label="Booking Method" value={lead.bookingMethod.replace(/_/g, " ")} />
            <Field label="Booking Provider" value={lead.bookingProvider ?? "—"} />
            <Field label="Staff Count" value={lead.staffCount !== null ? String(lead.staffCount) : "—"} />
            <Field label="Staff Count Confidence" value={lead.staffCountConfidence} />
            <Field label="Rating" value={lead.rating !== null ? `${lead.rating} (${lead.reviewCount} reviews)` : "—"} />
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Prospect Score <small>WEBSITE + INTEGRATED BOOKING fit</small></h2>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
            <ScorePill score={lead.prospectScore} />
            <div>
              <QualificationBadge status={lead.qualificationStatus} />{" "}
              <ConfidenceBadge level={lead.dataConfidence} />
            </div>
          </div>
          {lead.scoreReason && <p className="muted" style={{ marginTop: 0 }}>{lead.scoreReason}</p>}
          <h2 style={{ marginTop: 18 }}>Score Breakdown</h2>
          {lead.scoreBreakdown.length === 0 && <p className="empty-state">No score breakdown (duplicate or not yet scored).</p>}
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
        </div>

        <div className="panel">
          <h2>Research &amp; Pipeline</h2>
          <div className="field-grid">
            <Field label="Research Status" value={lead.researchStatus.replace(/_/g, " ")} />
            <Field label="Pipeline Stage" value={lead.pipelineStage.replace(/_/g, " ")} />
            <Field label="Discovery Source" value={lead.discoverySource} />
            <Field label="Date Discovered" value={new Date(lead.dateDiscovered).toLocaleString()} />
            <Field label="Date Last Researched" value={lead.dateLastResearched ? new Date(lead.dateLastResearched).toLocaleString() : "—"} />
            <Field label="Campaign / Job" value={`${lead.campaignId.slice(0, 8)}… / ${lead.jobId.slice(0, 8)}…`} />
          </div>

          {duplicateOf && (
            <p className="disabled-banner" style={{ marginTop: 14 }}>
              Flagged as a likely duplicate of <Link href={`/leads/${duplicateOf.id}`}>{duplicateOf.businessName}</Link>.
            </p>
          )}

          <h2 style={{ marginTop: 18 }}>Notes</h2>
          <p className="muted">{lead.notes || "—"}</p>

          <h2 style={{ marginTop: 18 }}>Future CRM Preview <small>mock only</small></h2>
          {crmRecords.length === 0 ? (
            <p className="empty-state">Not yet pushed to the (mock) CRM.</p>
          ) : (
            <table>
              <thead><tr><th>Stage</th><th>Synced</th><th>CRM</th></tr></thead>
              <tbody>
                {crmRecords.map((r) => (
                  <tr key={r.id}>
                    <td><StatusBadge status={r.stage} /></td>
                    <td className="muted">{new Date(r.syncedAt).toLocaleString()}</td>
                    <td className="muted">{r.externalCrmName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2 style={{ marginTop: 18 }}>Outreach</h2>
          <p className="disabled-banner">Outreach status: DISABLED — this skeleton phase never sends email or SMS.</p>
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
