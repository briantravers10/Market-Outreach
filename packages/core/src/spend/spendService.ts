import type { BillingInterval, CostEntry } from "./types";

/**
 * Turning a list of costs into the numbers the owner actually asked for:
 * what am I spending, and what is a lead costing me?
 *
 * Every figure here is computed from the entries on demand. Nothing is
 * cached or denormalised, because a spend total that can be stale is worse
 * than no spend total — you would only find out it was wrong by adding it up
 * yourself, which is the work this is supposed to remove.
 */

/** How many months a subscription has been running, counting the month it started. */
export function monthsBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  // Inclusive of the starting month: a subscription bought today has already
  // cost you this month's fee.
  return Math.max(0, months) + 1;
}

/**
 * A subscription's cost per month in minor units.
 *
 * A yearly plan divides by twelve and the remainder is kept rather than
 * dropped — twelve roundings of a third of a cent is not nothing when the
 * whole point is a figure that reconciles with a bank statement.
 */
export function monthlyAmountMinor(entry: Pick<CostEntry, "amountMinor" | "interval">): number {
  if (entry.interval === "yearly") return Math.round(entry.amountMinor / 12);
  return entry.amountMinor;
}

function isActive(entry: CostEntry, asOf: string): boolean {
  if (entry.kind !== "subscription") return false;
  if (entry.startedAt > asOf) return false;
  return entry.endedAt === null || entry.endedAt > asOf;
}

export interface SpendSummary {
  currency: string;
  /** Everything spent since the beginning, subscriptions accrued month by month plus usage. */
  totalMinor: number;
  /** What the active subscriptions cost every month, ignoring usage. */
  monthlyRunRateMinor: number;
  /** Subscriptions accrued this calendar month plus usage recorded in it. */
  thisMonthMinor: number;
  subscriptionTotalMinor: number;
  usageTotalMinor: number;
  activeSubscriptions: number;
  /** True when entries disagree on currency, in which case totals are not summed. */
  mixedCurrencies: boolean;
}

/**
 * Adds it all up.
 *
 * Refuses to sum across currencies. Converting would need a rate, a rate needs
 * a date, and a made-up conversion in a transparency page is precisely the
 * kind of confident wrong number this whole project is built to avoid. If it
 * ever happens the page says so and shows the entries instead of a total.
 */
export function summarizeSpend(entries: CostEntry[], asOf: string): SpendSummary {
  const currencies = new Set(entries.map((e) => e.currency.toUpperCase()));
  const mixedCurrencies = currencies.size > 1;
  const currency = currencies.size === 1 ? [...currencies][0] : "USD";

  if (mixedCurrencies) {
    return {
      currency,
      totalMinor: 0,
      monthlyRunRateMinor: 0,
      thisMonthMinor: 0,
      subscriptionTotalMinor: 0,
      usageTotalMinor: 0,
      activeSubscriptions: entries.filter((e) => isActive(e, asOf)).length,
      mixedCurrencies: true,
    };
  }

  const monthStart = `${asOf.slice(0, 7)}-01T00:00:00.000Z`;

  let subscriptionTotalMinor = 0;
  let usageTotalMinor = 0;
  let monthlyRunRateMinor = 0;
  let thisMonthMinor = 0;

  for (const entry of entries) {
    if (entry.kind === "subscription") {
      const perMonth = monthlyAmountMinor(entry);
      const until = entry.endedAt && entry.endedAt < asOf ? entry.endedAt : asOf;
      subscriptionTotalMinor += perMonth * monthsBetween(entry.startedAt, until);
      if (isActive(entry, asOf)) {
        monthlyRunRateMinor += perMonth;
        thisMonthMinor += perMonth;
      }
      continue;
    }

    // Usage and one-offs are spent on the day they happen.
    usageTotalMinor += entry.amountMinor;
    if (entry.startedAt >= monthStart && entry.startedAt <= asOf) {
      thisMonthMinor += entry.amountMinor;
    }
  }

  return {
    currency,
    totalMinor: subscriptionTotalMinor + usageTotalMinor,
    monthlyRunRateMinor,
    thisMonthMinor,
    subscriptionTotalMinor,
    usageTotalMinor,
    activeSubscriptions: entries.filter((e) => isActive(e, asOf)).length,
    mixedCurrencies: false,
  };
}

export interface CostPerLead {
  /** Null rather than zero when there is nothing to divide by — an undefined ratio is not free. */
  perLeadMinor: number | null;
  perReadyLeadMinor: number | null;
  perQualifiedLeadMinor: number | null;
}

/**
 * What a lead costs.
 *
 * Three denominators rather than one, because they answer different questions
 * and only showing the flattering one would be a kind of lying. Divided into
 * every lead the total is tiny and meaningless; divided into the leads
 * actually worth calling it is the real number — and that is the one that
 * decides whether this is worth running.
 */
export function costPerLead(
  totalMinor: number,
  counts: { total: number; ready: number; qualified: number }
): CostPerLead {
  const per = (n: number) => (n > 0 ? Math.round(totalMinor / n) : null);
  return {
    perLeadMinor: per(counts.total),
    perReadyLeadMinor: per(counts.ready),
    perQualifiedLeadMinor: per(counts.qualified),
  };
}

/** Minor units as a readable amount. Never rounds away a fraction of a cent silently. */
export function formatMoney(minor: number, currency: string): string {
  const symbol = currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const sign = minor < 0 ? "-" : "";
  return `${sign}${symbol}${whole.toLocaleString()}.${String(cents).padStart(2, "0")}`;
}

/**
 * A per-unit cost small enough that whole cents would read as zero.
 *
 * Half a cent per lookup is the actual figure for search-API spend, and
 * rounding it to "$0.00" would make the most important number on the page
 * look like it was free.
 */
export function formatUnitCost(minor: number | null, currency: string): string {
  if (minor === null) return "—";
  if (minor === 0) return formatMoney(0, currency);
  if (minor < 100) {
    const symbol = currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$";
    return `${symbol}${(minor / 100).toFixed(minor < 10 ? 4 : 3)}`;
  }
  return formatMoney(minor, currency);
}

/** What one unit of a metered purchase cost, for "half a cent per search". */
export function unitCostMinor(entry: CostEntry): number | null {
  if (!entry.units || entry.units <= 0) return null;
  return entry.amountMinor / entry.units;
}

export function describeInterval(interval: BillingInterval | null): string {
  if (interval === "monthly") return "per month";
  if (interval === "yearly") return "per year";
  return "one-off";
}
