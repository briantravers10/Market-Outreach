import Link from "next/link";
import {
  ANALYSIS_VERSION,
  assessReadiness,
  describeHoldReason,
  getIndustries,
  type LeadFilter,
} from "@market-outreach/core";
import { getRepos } from "../../../lib/data";
import { ConfidenceBadge, QualificationBadge, ScorePill } from "../../../components/Badges";
import { ExportCsvLink } from "../../../components/ExportCsvLink";

interface LeadsSearchParams {
  q?: string;
  state?: string;
  city?: string;
  zip?: string;
  industry?: string;
  minScore?: string;
  websiteStatus?: string;
  onlineBookingStatus?: string;
  bookingProvider?: string;
  minStaffCount?: string;
  dataConfidence?: string;
  researchStatus?: string;
  qualificationStatus?: string;
  sort?: string;
  page?: string;
  /** "1" to see the holding area instead of the working list. */
  holding?: string;
  /** "1" to see businesses that already book online — kept, not discarded. */
  booked?: string;
}

export const dynamic = "force-dynamic";

/**
 * A statewide import is tens of thousands of leads, so this page is paged
 * rather than complete. 200 is a deliberate compromise: enough that scrolling
 * beats clicking on a normal filtered view, few enough that the table stays
 * responsive on a phone.
 */
const PAGE_SIZE = 200;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<LeadsSearchParams> }) {
  const params = await searchParams;
  const repos = getRepos();
  const industries = getIndustries();
  const industryLabels = new Map(industries.map((i) => [i.id, i.label]));

  const holding = params.holding === "1";
  const booked = params.booked === "1";
  const page = Math.max(1, Number(params.page) || 1);
  const sort = params.sort === "discovered" || params.sort === "name" ? params.sort : "score";

  const filter: LeadFilter = {
    state: params.state?.toUpperCase() || undefined,
    city: params.city || undefined,
    zip: params.zip || undefined,
    industry: params.industry || undefined,
    minScore: params.minScore ? Number(params.minScore) : undefined,
    websiteStatus: (params.websiteStatus as LeadFilter["websiteStatus"]) || undefined,
    onlineBookingStatus: (params.onlineBookingStatus as LeadFilter["onlineBookingStatus"]) || undefined,
    bookingProvider: params.bookingProvider || undefined,
    minStaffCount: params.minStaffCount ? Number(params.minStaffCount) : undefined,
    dataConfidence: (params.dataConfidence as LeadFilter["dataConfidence"]) || undefined,
    researchStatus: (params.researchStatus as LeadFilter["researchStatus"]) || undefined,
    qualificationStatus: (params.qualificationStatus as LeadFilter["qualificationStatus"]) || undefined,
    orderBy: sort,
    // THE GATE.
    //
    // By default this page shows only leads that have finished being
    // researched. A half-researched lead is not a worse lead, it is an unknown
    // one, and putting it in a ranked list is how someone ends up phoning a
    // business that already books online. The holding area is one click away
    // and says why each lead is in it — but it is never the default, and it is
    // never mixed in.
    readyForReview: { ready: !holding, analysisVersion: ANALYSIS_VERSION },
    // The three views are exclusive: prospects (no booking), already-booking,
    // and still-being-researched. A business on Booksy is a slower sale, not a
    // dead one — what is being sold is free — so they stay findable rather
    // than being filtered out of existence.
    ...(holding ? {} : { hasBookingProvider: booked }),
  };

  const [readyCount, holdingCount] = await Promise.all([
    repos.leads.count({
      readyForReview: { ready: true, analysisVersion: ANALYSIS_VERSION },
      hasBookingProvider: false,
    }),
    repos.leads.count({ readyForReview: { ready: false, analysisVersion: ANALYSIS_VERSION } }),
  ]);
  const bookedCount = await repos.leads.count({
    readyForReview: { ready: true, analysisVersion: ANALYSIS_VERSION },
    hasBookingProvider: true,
  });

  // The name search has no SQL column behind it, so it filters what this page
  // fetched. Asking for one row more than we show is how the pager knows there
  // is a next page without counting the whole table.
  let leads = await repos.leads.list({ ...filter, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
  const hasNextPage = leads.length > PAGE_SIZE;
  leads = leads.slice(0, PAGE_SIZE);
  if (params.q) {
    const q = params.q.toLowerCase();
    leads = leads.filter((l) => l.businessName.toLowerCase().includes(q));
  }

  // Paging must preserve every filter and change only the page number.
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== "page") query.set(key, value);
    }
    query.set("page", String(target));
    return `/leads?${query.toString()}`;
  };

  return (
    <div>
      <div className="page-header">
        <h1>{holding ? "Still being researched" : booked ? "Already books online" : "Leads"}</h1>
        <p>
          {holding
            ? "These are not ready to call. Each one is waiting on something — the reason is on the right. They move across on their own as the research finishes; nothing here needs you."
            : booked
              ? "These already book through a platform, so they score low — but they are kept, not discarded. What you sell is free, which makes them a slower sale rather than no sale. Worth a look if you ever want more names."
              : "Businesses that have finished being researched, so the booking answer behind every score is known. Filter, then export to review in Excel or Numbers."}
        </p>
      </div>

      <div className="lead-tabs">
        <Link href="/leads" className={!holding && !booked ? "lead-tab lead-tab-active" : "lead-tab"}>
          Ready to work <span className="lead-tab-count">{readyCount.toLocaleString()}</span>
        </Link>
        <Link href="/leads?booked=1" className={booked ? "lead-tab lead-tab-active" : "lead-tab"}>
          Already books online <span className="lead-tab-count">{bookedCount.toLocaleString()}</span>
        </Link>
        <Link href="/leads?holding=1" className={holding ? "lead-tab lead-tab-active" : "lead-tab"}>
          Still being researched <span className="lead-tab-count">{holdingCount.toLocaleString()}</span>
        </Link>
      </div>

      <form className="filter-bar" method="get">
        <div className="filter-field">
          <label>Search</label>
          <input type="text" name="q" placeholder="Business name…" defaultValue={params.q || ""} />
        </div>
        <div className="filter-field">
          <label>State</label>
          <input type="text" name="state" placeholder="FL" maxLength={2} defaultValue={params.state || ""} />
        </div>
        <div className="filter-field">
          <label>City</label>
          <input type="text" name="city" placeholder="Miami" defaultValue={params.city || ""} />
        </div>
        <div className="filter-field">
          <label>ZIP</label>
          <input type="text" name="zip" placeholder="33139" maxLength={5} defaultValue={params.zip || ""} />
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
            <option value="UNKNOWN">Not checked yet</option>
            <option value="NONE">No Online Booking</option>
            <option value="THIRD_PARTY_BOOKING_SYSTEM">Third-Party</option>
            <option value="INTEGRATED_BOOKING_SYSTEM">Integrated</option>
          </select>
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
          <label>Qualification</label>
          <select name="qualificationStatus" defaultValue={params.qualificationStatus || ""}>
            <option value="">All</option>
            <option value="UNQUALIFIED">Unqualified</option>
            <option value="QUALIFIED">Qualified</option>
            <option value="HIGH_PRIORITY">High Priority</option>
            <option value="DISQUALIFIED">Disqualified</option>
          </select>
        </div>
        <div className="filter-field">
          <label>Sort By</label>
          <select name="sort" defaultValue={sort}>
            <option value="score">Highest score</option>
            <option value="discovered">Most recent</option>
            <option value="name">Business name</option>
          </select>
        </div>
        <button className="btn btn-secondary" type="submit">Apply Filters</button>
        <ExportCsvLink params={{ ...params }} />
        <Link href="/high-priority" className="btn-ghost" style={{ display: "inline-flex", alignItems: "center" }}>80+ only →</Link>
      </form>

      <div className="panel">
        <h2>
          Leads <small>(showing {leads.length}{page > 1 || hasNextPage ? ` — page ${page}` : ""})</small>
        </h2>
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>City</th>
              <th>ZIP</th>
              <th>Industry</th>
              <th>Score</th>
              <th>Confidence</th>
              <th>Website</th>
              <th>Booking</th>
              <th>{holding ? "Waiting on" : booked ? "Books through" : "Qualification"}</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td><Link href={`/leads/${lead.id}`}>{lead.businessName}</Link></td>
                <td>{lead.city}</td>
                <td className="muted">{lead.zip}</td>
                <td>{industryLabels.get(lead.industry) ?? lead.industry}</td>
                <td><ScorePill score={lead.prospectScore} /></td>
                <td><ConfidenceBadge level={lead.dataConfidence} /></td>
                <td className="muted">{lead.websiteStatus === "NONE" ? "No website" : "Has website"}</td>
                <td className="muted">
                  {lead.onlineBookingStatus === "UNKNOWN"
                    ? "Not checked"
                    : lead.bookingMethod.replace(/_/g, " ").toLowerCase()}
                </td>
                <td>
                  {booked ? (
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      {lead.bookingProvider ?? "an unrecognised tool"}
                    </span>
                  ) : holding ? (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {describeHoldReason(assessReadiness(lead).reason ?? "never-researched")}
                    </span>
                  ) : (
                    <QualificationBadge status={lead.qualificationStatus} />
                  )}
                </td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={9} className="empty-state">
                  {!holding && readyCount === 0 && holdingCount > 0 ? (
                    /* An empty working list with a full holding area is not an
                       error and must not read like one. It is the gate doing
                       its job while the research catches up, and saying so is
                       the difference between "wait" and "something is broken". */
                    <>
                      <strong>Nothing has finished being researched yet.</strong>
                      <br />
                      All {holdingCount.toLocaleString()} leads are still being worked on — the research runs on its
                      own every ten minutes and they appear here as they finish. Nothing is wrong and nothing is
                      lost; they are visible under <Link href="/leads?holding=1">Still being researched</Link>, with
                      the reason each one is waiting.
                    </>
                  ) : (
                    "No leads match these filters."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {(page > 1 || hasNextPage) && (
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", alignItems: "center" }}>
            {page > 1 && <Link className="btn btn-secondary" href={pageHref(page - 1)}>← Previous</Link>}
            {hasNextPage && <Link className="btn btn-secondary" href={pageHref(page + 1)}>Next →</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
