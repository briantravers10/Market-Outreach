import { getRepos } from "../../../lib/data";
import { isDemoMode } from "../../../lib/demo";
import { ImportRunner } from "./ImportRunner";

export const dynamic = "force-dynamic";

/**
 * Loading real businesses into the database.
 *
 * Separate from Campaigns deliberately: a campaign is an instruction to go and
 * find businesses matching a description, whereas this is loading a dataset
 * that already exists. Conflating them would make "target 50 leads" mean two
 * different things on one screen.
 */
export default async function ImportPage() {
  const repos = getRepos();
  // Counted in SQL. Loading seventy-seven thousand leads to display three
  // numbers is how this page used to work, and it was slow enough to matter.
  const stats = await repos.leads.summaryStats({ state: "FL" });

  return (
    <div>
      <div className="page-header">
        <h1>Import</h1>
        <p>Load real businesses from the Overture Maps open dataset, then score them.</p>
      </div>

      <div className="panel">
        <h2>Florida</h2>
        <p className="muted">
          Every barber, salon, spa, nail bar, groomer, tattoo studio, trainer and detailer Overture holds an
          address for in Florida — about 77,000 businesses across 714 towns and cities. The data is open
          (CDLA Permissive), so unlike Google Places we are allowed to keep it.
        </p>
        {isDemoMode ? (
          <p className="muted">The public demo runs on a read-only snapshot, so importing is disabled here.</p>
        ) : (
          <ImportRunner source="overture-fl" label="Florida" expected={77325} />
        )}
      </div>

      <div className="panel">
        <h2>What is on file now</h2>
        <div className="kpi-grid">
          <div className="kpi-tile">
            <span className="label">Florida businesses</span>
            <span className="value">{stats.total.toLocaleString()}</span>
          </div>
          <div className="kpi-tile">
            <span className="label">No website at all</span>
            <span className="value">{stats.noWebsite.toLocaleString()}</span>
          </div>
          <div className="kpi-tile">
            <span className="label">With a phone number</span>
            <span className="value">{stats.withPhone.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>What the scores mean right now</h2>
        <p className="muted">
          Nothing is marked Qualified yet, and that is correct rather than broken. The biggest single factor in
          the score is whether a business already takes bookings online — and finding that out means fetching
          their website and reading it, which has not happened. Until it does, booking status reads
          &ldquo;not checked&rdquo; and scores nothing either way.
        </p>
        <p className="muted">
          What you can act on today is the <strong>no website</strong> cohort: {stats.noWebsite.toLocaleString()} Florida
          businesses with no website at all, almost all with a phone number. Sort the Leads page by score and
          they are at the top.
        </p>
      </div>
    </div>
  );
}
