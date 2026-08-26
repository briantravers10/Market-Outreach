import {
  ANALYSIS_VERSION,
  costPerLead,
  describeInterval,
  formatMoney,
  formatUnitCost,
  monthlyAmountMinor,
  summarizeSpend,
  unitCostMinor,
  SEARCH_SPEND_CAP_KEY,
} from "@market-outreach/core";
import { getRepos } from "../../../lib/data";
import { KpiTile } from "../../../components/KpiTile";
import { addCostAction, endSubscriptionAction, setSearchCapAction } from "../../../lib/spendActions";

export const dynamic = "force-dynamic";

/**
 * What this operation costs, and what that works out at per lead.
 *
 * Every figure is computed from the entries on each load. Nothing is cached,
 * because a spend total that can be stale is worse than none — you would only
 * discover it was wrong by adding it up yourself.
 */
export default async function SpendPage() {
  const repos = getRepos();
  const now = new Date().toISOString();

  const [entries, total, ready, qualified, capRaw] = await Promise.all([
    repos.costs.list(),
    repos.leads.count({ isDuplicate: false }),
    repos.leads.count({ readyForReview: { ready: true, analysisVersion: ANALYSIS_VERSION } }),
    repos.leads.count({ qualificationStatus: "QUALIFIED", isDuplicate: false }),
    repos.settings.get(SEARCH_SPEND_CAP_KEY),
  ]);

  // No cap set means no paid lookups run at all, so forgetting to set one
  // cannot cost anything. Zero is the safe default, not "unlimited".
  const capMinor = Number.parseInt(capRaw ?? "0", 10) || 0;
  const searchSpentMinor = entries
    .filter((e) => e.automatic && e.kind !== "subscription")
    .reduce((sum, e) => sum + e.amountMinor, 0);
  const capRemainingMinor = Math.max(0, capMinor - searchSpentMinor);

  const summary = summarizeSpend(entries, now);
  const per = costPerLead(summary.totalMinor, { total, ready, qualified });
  const money = (minor: number) => formatMoney(minor, summary.currency);

  const subscriptions = entries.filter((e) => e.kind === "subscription");
  const usage = entries.filter((e) => e.kind !== "subscription");
  const active = subscriptions.filter((e) => !e.endedAt);

  return (
    <div>
      <div className="page-header">
        <h1>Spend</h1>
        <p>
          Everything this operation costs, and what that works out at per lead. Subscriptions accrue every month;
          metered usage counts once, on the day it was bought.
        </p>
      </div>

      {summary.mixedCurrencies ? (
        <div className="auth-notice" style={{ marginBottom: 16 }}>
          <p style={{ margin: 0 }}>
            <strong>Entries are in more than one currency, so no total is shown.</strong> Converting would need an
            exchange rate for a particular day, and a made-up rate on a page whose entire job is transparency would be
            the worst kind of wrong number. Record everything in one currency, or read the lists below separately.
          </p>
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <KpiTile label="Spent to date" value={money(summary.totalMinor)} />
            <KpiTile label="This month" value={money(summary.thisMonthMinor)} />
            <KpiTile label="Monthly run rate" value={money(summary.monthlyRunRateMinor)} note={`${active.length} active`} />
            <KpiTile label="Metered usage" value={money(summary.usageTotalMinor)} />
          </div>

          <div className="panel">
            <h2>What a lead costs</h2>
            <div className="kpi-grid">
              <KpiTile
                label="Per lead found"
                value={formatUnitCost(per.perLeadMinor, summary.currency)}
                note={`${total.toLocaleString()} leads`}
              />
              <KpiTile
                label="Per researched lead"
                value={formatUnitCost(per.perReadyLeadMinor, summary.currency)}
                note={`${ready.toLocaleString()} finished`}
              />
              <KpiTile
                label="Per qualified lead"
                value={formatUnitCost(per.perQualifiedLeadMinor, summary.currency)}
                note={`${qualified.toLocaleString()} worth calling`}
              />
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
              Three figures rather than one, because they answer different questions. Divided into every business we
              found, the cost is tiny and means little. Divided into the ones actually worth ringing, it is the real
              number — and that is the one that decides whether this is worth running.
            </p>
          </div>
        </>
      )}

      <div className="panel">
        <h2>Subscriptions <small>{active.length} active</small></h2>
        {subscriptions.length === 0 && (
          <p className="empty-state">Nothing recorded yet. Add Pipedrive, Vercel, Supabase — whatever you pay for.</p>
        )}
        {subscriptions.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>What for</th>
                  <th>Amount</th>
                  <th>Per month</th>
                  <th>Since</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((entry) => (
                  <tr key={entry.id} style={entry.endedAt ? { opacity: 0.5 } : undefined}>
                    <td>{entry.vendor}</td>
                    <td className="muted">{entry.description || "—"}</td>
                    <td className="mono">
                      {formatMoney(entry.amountMinor, entry.currency)}{" "}
                      <span className="muted">{describeInterval(entry.interval)}</span>
                    </td>
                    <td className="mono">{formatMoney(monthlyAmountMinor(entry), entry.currency)}</td>
                    <td className="muted">{entry.startedAt.slice(0, 10)}</td>
                    <td>
                      {entry.endedAt ? (
                        <span className="muted" style={{ fontSize: 12 }}>Ended {entry.endedAt.slice(0, 10)}</span>
                      ) : (
                        <form action={endSubscriptionAction}>
                          <input type="hidden" name="id" value={entry.id} />
                          <button className="btn btn-small" type="submit">Cancelled</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Marking one cancelled stops it accruing from today and keeps what you already paid. Nothing is deleted,
          because money that left your account still left it.
        </p>
      </div>

      <div className="panel">
        <h2>Metered usage <small>lead lookups, sends</small></h2>
        {usage.length === 0 && (
          <p className="empty-state">
            Nothing yet. Search-API lookups will record themselves here as they happen, with what each one cost.
          </p>
        )}
        {usage.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>What for</th>
                  <th>Amount</th>
                  <th>Units</th>
                  <th>Each</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {entry.vendor}
                      {entry.automatic && (
                        <span className="muted" style={{ fontSize: 11 }}> · auto</span>
                      )}
                    </td>
                    <td className="muted">{entry.description || "—"}</td>
                    <td className="mono">{formatMoney(entry.amountMinor, entry.currency)}</td>
                    <td className="mono">
                      {entry.units ? `${entry.units.toLocaleString()} ${entry.unitLabel ?? ""}` : "—"}
                    </td>
                    <td className="mono">{formatUnitCost(unitCostMinor(entry), entry.currency)}</td>
                    <td className="muted">{entry.startedAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Paid lookup budget <small>hard ceiling</small></h2>
        <div className="kpi-grid">
          <KpiTile label="Cap" value={capMinor > 0 ? money(capMinor) : "Not set"} />
          <KpiTile label="Spent on lookups" value={money(searchSpentMinor)} />
          <KpiTile
            label="Remaining"
            value={capMinor > 0 ? money(capRemainingMinor) : "—"}
            note={capMinor > 0 ? `${Math.floor(capRemainingMinor / 0.5).toLocaleString()} lookups left` : undefined}
          />
        </div>

        <form action={setSearchCapAction} className="spend-form">
          <label className="field-label">
            Set the cap
            <input className="auth-input" name="cap" placeholder="200.00" inputMode="decimal" defaultValue={capMinor > 0 ? (capMinor / 100).toFixed(2) : ""} />
          </label>
          <div className="spend-form-submit">
            <button className="btn btn-primary" type="submit">Save cap</button>
          </div>
        </form>

        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Checked before every paid search, against what has already been spent in the database — so it holds
          across restarts and however many jobs are running at once. Reaching it stops the searches; it never
          marks a business as having no booking, because &ldquo;we ran out of budget&rdquo; is not a finding.
          <strong> A cap of zero means no paid lookups happen at all</strong>, which is the default, so forgetting
          to set one cannot cost you anything.
        </p>
      </div>

      <div className="panel">
        <h2>Record a cost</h2>
        <form action={addCostAction} className="spend-form">
          <label className="field-label">
            Vendor
            <input className="auth-input" name="vendor" placeholder="Pipedrive" required />
          </label>
          <label className="field-label">
            What for
            <input className="auth-input" name="description" placeholder="CRM, Advanced plan" />
          </label>
          <label className="field-label">
            Amount
            <input className="auth-input" name="amount" placeholder="39.00" required inputMode="decimal" />
          </label>
          <label className="field-label">
            Currency
            <input className="auth-input" name="currency" defaultValue="USD" maxLength={3} />
          </label>
          <label className="field-label">
            Type
            <select className="auth-input" name="kind" defaultValue="subscription">
              <option value="subscription">Subscription</option>
              <option value="usage">One-off / usage</option>
            </select>
          </label>
          <label className="field-label">
            How often
            <select className="auth-input" name="interval" defaultValue="monthly">
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <label className="field-label">
            Started
            <input className="auth-input" name="startedAt" type="date" />
          </label>
          <label className="field-label">
            Units bought <span className="muted">(usage only)</span>
            <input className="auth-input" name="units" placeholder="1000" inputMode="numeric" />
          </label>
          <div className="spend-form-submit">
            <button className="btn btn-primary" type="submit">Record it</button>
          </div>
        </form>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Type the amount however you like — <code>39</code>, <code>39.00</code> and <code>$39</code> all mean the
          same thing. &ldquo;How often&rdquo; is ignored for one-off entries, so a usage top-up can never
          accidentally recur.
        </p>
      </div>
    </div>
  );
}
