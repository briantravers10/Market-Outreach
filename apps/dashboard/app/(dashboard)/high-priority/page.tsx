import Link from "next/link";
import { getIndustries, LEAD_PRESETS, findLeadPreset } from "@market-outreach/core";
import { getRepos } from "../../../lib/data";
import { ConfidenceBadge, QualificationBadge, ScorePill } from "../../../components/Badges";
import { ExportCsvLink } from "../../../components/ExportCsvLink";

export const dynamic = "force-dynamic";

export default async function HighPriorityPage({ searchParams }: { searchParams: Promise<{ preset?: string }> }) {
  const params = await searchParams;
  const repos = getRepos();
  const industryLabels = new Map(getIndustries().map((i) => [i.id, i.label]));

  const highPriority = await repos.leads.list({ minScore: 80 });
  const preset = findLeadPreset(params.preset);
  const leads = preset ? highPriority.filter(preset.test) : highPriority;

  return (
    <div>
      <div className="page-header">
        <h1>High-Priority Leads</h1>
        <p>Prospect score 80+. These are the strongest fits for website + integrated booking.</p>
      </div>

      <div className="filter-bar">
        <Link href="/high-priority" className={`btn ${!preset ? "" : "btn-secondary"}`}>All ({highPriority.length})</Link>
        {LEAD_PRESETS.map((p) => {
          const count = highPriority.filter(p.test).length;
          return (
            <Link
              key={p.key}
              href={`/high-priority?preset=${p.key}`}
              className={`btn ${preset?.key === p.key ? "" : "btn-secondary"}`}
            >
              {p.label} ({count})
            </Link>
          );
        })}
        <ExportCsvLink
          params={{ minScore: "80", preset: params.preset }}
          view="high-priority"
          count={leads.length}
        />
      </div>

      <div className="panel">
        <h2>Leads <small>({leads.length})</small></h2>
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>City</th>
              <th>Industry</th>
              <th>Score</th>
              <th>Confidence</th>
              <th>Website</th>
              <th>Booking</th>
              <th>Staff</th>
              <th>Rating</th>
              <th>Qualification</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td><Link href={`/leads/${lead.id}`}>{lead.businessName}</Link></td>
                <td>{lead.city}</td>
                <td>{industryLabels.get(lead.industry) ?? lead.industry}</td>
                <td><ScorePill score={lead.prospectScore} /></td>
                <td><ConfidenceBadge level={lead.dataConfidence} /></td>
                <td className="muted">{lead.websiteStatus === "NONE" ? "No website" : lead.websiteQuality}</td>
                <td className="muted">{lead.bookingMethod.replace(/_/g, " ")}</td>
                <td className="muted">{lead.staffCount ?? "—"}</td>
                <td className="muted">{lead.rating ?? "—"}</td>
                <td><QualificationBadge status={lead.qualificationStatus} /></td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr><td colSpan={10} className="empty-state">No high-priority leads match this filter yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
