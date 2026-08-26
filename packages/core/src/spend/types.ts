/**
 * What this operation costs to run.
 *
 * Money is held in **integer minor units** — cents, pence — and never as a
 * float. `0.1 + 0.2 !== 0.3` in binary floating point, and a spend page whose
 * total is off by a penny is a spend page nobody trusts, which defeats the
 * entire purpose of having one.
 *
 * Two kinds of cost behave differently and must not be added naively:
 *
 *   subscription  recurs until cancelled. Pipedrive at $39/month costs $39
 *                 this month whether you looked up one lead or ten thousand.
 *   usage         bought once, for a quantity. A search API top-up of $5 for
 *                 1,000 lookups is spent when it is spent.
 *
 * Treating a subscription as a one-off understates the running cost; treating
 * usage as recurring overstates it. Both mistakes make the cost-per-lead
 * figure a lie, so the distinction is in the type rather than in a convention.
 */

export type CostKind = "subscription" | "usage" | "one-off";

export type BillingInterval = "monthly" | "yearly";

export interface CostEntry {
  id: string;
  kind: CostKind;
  /** Who is being paid: "Pipedrive", "Brave Search", "Vercel". */
  vendor: string;
  /** What it buys, in the owner's words. */
  description: string;
  /**
   * Integer minor units. 3900 is $39.00.
   *
   * For a subscription this is the amount per `interval`, not per month —
   * a yearly plan stores the yearly figure and is normalised when summed.
   */
  amountMinor: number;
  /** ISO 4217. Mixing currencies in one total is refused rather than guessed at. */
  currency: string;
  /** Subscriptions only. Null for usage and one-offs. */
  interval: BillingInterval | null;
  /** When this began costing money. */
  startedAt: string;
  /** Subscriptions: when cancelled. Null means still running. */
  endedAt: string | null;
  /** Usage only: how many units the money bought, for a unit-cost figure. */
  units: number | null;
  /** "searches", "lookups", "emails". */
  unitLabel: string | null;
  /**
   * Set when the system recorded this itself rather than the owner typing it.
   *
   * Worth distinguishing: an automatic entry is only as right as the code that
   * wrote it, and if the figures ever look wrong this is the first thing to
   * check.
   */
  automatic: boolean;
  createdAt: string;
}

export interface CostRepository {
  upsert(entry: CostEntry): Promise<CostEntry>;
  list(): Promise<CostEntry[]>;
  getById(id: string): Promise<CostEntry | null>;
  remove(id: string): Promise<void>;
}

/** Operator-set values stored as strings; callers parse what they asked for. */
export interface SettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** The one setting that can cost money if it is wrong, so it gets a name. */
export const SEARCH_SPEND_CAP_KEY = "search_spend_cap_minor";
