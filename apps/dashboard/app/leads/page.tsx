import Link from "next/link";
import { getIndustries, getTerritories, type LeadFilter } from "@market-outreach/core";
import { getRepos } from "../../lib/data";
import { ConfidenceBadge, QualificationBadge, ScorePill } from "../../components/Badges";

interface LeadsSearchParams {
  q?: string;
  city?: string;
  industry?: string;
  minScore?: string;
  websiteStatus?: string;
  onlineBookingStatus?: string;
  bookingProvider?: string;
  minStaffCount?: string;
  dataConfidence?: string;
  researchStatus?: string;
  qualificationStatus?: string;
}

export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<LeadsSearchParams> }) {
  const params = await searchParams;
  const repos = getRepos();
  const territories = getTerritories();
  const industries = getIndustries();
  const industryLabels = new Map(industries.map((i) => [i.id, i.label]));

  const filter: LeadFilter = {
    city: params.city || undefined,
    industry: params.industry || undefined,
    minScore: params.minScore ? Number(params.minScore) : undefined,
    websiteStatus: (params.websiteStatus as LeadFilter["websiteStatus"]) || undefined,
    onlineBookingStatus: (params.onlineBookingStatus as LeadFilter["onlineBookingStatus"]) || undefined,
    bookingProvider: params.bookingProvider || undefined,
    minStaffCount: params.minStaffCount ? Number(params.minStaffCount) : undefined,
    dataConfidence: (params.dataConfidence as LeadFilter["dataConfidence"]) || undefined,
    researchStatus: (params.researchStatus as LeadFilter["researchStatus"]) || undefined,
    qualificationStatus: (params.qualificationStatus as LeadFilter["qualificationStatus"]) || undefined,
  };

  let leads = repos.leads.list(filter);
  if (params.q) {
    const q = params.q.toLowerCase();
    leads = leads.filter((l) => l.businessName.toLowerCase().includes(q));
  }

  return (
    <div>
      <div className="page-header">
        <h1>Leads</h1>
        <p>All researched businesses across every campaign. Fake data only.</p>
      </div>

      <form className="filter-bar" method="get">
        <div className="filter-field">
          <label>Search</label>
          <input type="text" name="q" placeholder="Business name…" defaultValue={params.q || ""} />
        </div>
        <div className="filter-field">
          <label>City</label>
          <select name="city" defaultValue={params.city || ""}>
            <option value="">All</option>
            {territories.map((t) => <option key={t.id} value={t.city}>{t.city}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Industry</label>
          <select name="industry" defaultValue={params.industry || ""}>
            <option value="">All</option>
            {industries.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label>Min Score</label>
          <input type="number" name="minScore" min={0} max={100} defaultValue={params.minScore || ""} />
        </div>
        <div className="filter-field">
          <label>Website Status</label>
          <select name="websiteStatus" defaultValue={params.websiteStatus || ""}>
            <option value="">All</option>
            <option value="NONE">No Website</option>
            <option value="EXISTS">Has Website</option>
          </select>
        </div>
        <div className="filter-field">
          <label>Booking Status</label>
          <select name="onlineBookingStatus" defaultValue={params.onlineBookingStatus || ""}>
            <option value="">All</option>
            <option value="NONE">No Online Booking</option>
            <option value="THIRD_PARTY_BOOKING_SYSTEM">Third-Party</option>
            <option value="INTEGRATED_BOOKING_SYSTEM">Integrated</option>
          </select>
        </div>
        <div className="filter-field">
          <label>Booking Provider</label>
          <input type="text" name="bookingProvider" placeholder="e.g. Vagaro" defaultValue={params.bookingProvider || ""} />
        </div>
        <div className="filter-field">
          <label>Min Staff</label>
          <input type="number" name="minStaffCount" min={0} defaultValue={params.minStaffCount || ""} />
        </div>
        <div className="filter-field">
          <label>Data Confidence</label>
          <select name="dataConfidence" defaultValue={params.dataConfidence || ""}>
            <option value="">All</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
        <div className="filter-field">
          <label>Research Status</label>
          <select name="researchStatus" defaultValue={params.researchStatus || ""}>
            <option value="">All</option>
            <option value="ANALYZED">Analyzed</option>
            <option value="COMPLETE">Complete</option>
          </select>
        </div>
        <div className="filter-field">
          <label>Qualification</label>
          <select name="qualificationStatus" defaultValue={params.qualificationStatus || ""}>
            <option value="">All</option>
            <option value="UNQUALIFIED">Unqualified</option>
            <option value="QUALIFIED">Qualified</option>
            <option value="HIGH_PRIORITY">High Priority</option>
            <option value="DISQUALIFIED">Disqualified</option>
          </select>
        </div>
        <button className="btn btn-secondary" type="submit">Apply Filters</button>
        <Link href="/high-priority" className="btn-ghost" style={{ display: "inline-flex", alignItems: "center" }}>80+ only →</Link>
      </form>

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
              <th>Stages</th>
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
                <td className="muted">{lead.stagesCompleted.length}/5</td>
                <td><QualificationBadge status={lead.qualificationStatus} /></td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr><td colSpan={9} className="empty-state">No leads match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
