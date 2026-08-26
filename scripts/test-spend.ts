/**
 * Spend tracking test suite.
 *
 * Money code, so the bar is different: every figure here will be compared
 * against a bank statement by someone deciding whether this operation is worth
 * running. A total that is quietly a penny out is worse than no total, because
 * the only way to catch it is to add it up by hand — which is the work this
 * exists to remove.
 *
 *   npm run test-spend
 */
import {
  costPerLead,
  formatMoney,
  formatUnitCost,
  monthlyAmountMinor,
  monthsBetween,
  summarizeSpend,
  unitCostMinor,
  type CostEntry,
} from "@market-outreach/core";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

let n = 0;
function cost(overrides: Partial<CostEntry> = {}): CostEntry {
  n += 1;
  return {
    id: `cost_${n}`,
    kind: "subscription",
    vendor: "Pipedrive",
    description: "CRM seat",
    amountMinor: 3900,
    currency: "USD",
    interval: "monthly",
    startedAt: "2026-06-15T00:00:00.000Z",
    endedAt: null,
    units: null,
    unitLabel: null,
    automatic: false,
    createdAt: "2026-06-15T00:00:00.000Z",
    ...overrides,
  };
}

const NOW = "2026-08-26T12:00:00.000Z";

/**
 * Mirrors parseAmountToMinor in the dashboard's spendActions.
 *
 * Duplicated rather than imported because that module is a "use server" file
 * and importing it here would pull the Next.js server runtime into a plain
 * script. The duplication is deliberate and small; if the two ever diverge,
 * these cases are the specification.
 */
function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$£€,\s]/g, "");
  if (!cleaned) return null;
  if (!/^-?\d*(\.\d*)?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [wholeRaw = "0", fracRaw = ""] = cleaned.replace("-", "").split(".");
  const whole = Number.parseInt(wholeRaw || "0", 10);
  if (!Number.isFinite(whole)) return null;
  const frac = Number.parseInt((fracRaw + "00").slice(0, 2), 10);
  if (!Number.isFinite(frac)) return null;
  const minor = whole * 100 + frac;
  return negative ? -minor : minor;
}

function main(): void {
  // ---------------------------------------------------------------------------
  section("Counting months");
  // ---------------------------------------------------------------------------

  check("the starting month counts", monthsBetween("2026-08-01T00:00:00Z", "2026-08-26T00:00:00Z") === 1);
  check("June to August is three months", monthsBetween("2026-06-15T00:00:00Z", "2026-08-26T00:00:00Z") === 3);
  check("across a year boundary", monthsBetween("2025-11-01T00:00:00Z", "2026-01-01T00:00:00Z") === 3);
  check("a future start is not negative", monthsBetween("2027-01-01T00:00:00Z", "2026-01-01T00:00:00Z") === 1);
  check("nonsense dates do not throw", monthsBetween("not-a-date", NOW) === 0);

  // ---------------------------------------------------------------------------
  section("Normalising to a monthly figure");
  // ---------------------------------------------------------------------------

  check("a monthly plan is itself", monthlyAmountMinor({ amountMinor: 3900, interval: "monthly" }) === 3900);
  check("a yearly plan divides by twelve", monthlyAmountMinor({ amountMinor: 12000, interval: "yearly" }) === 1000);
  check(
    "an awkward yearly figure rounds rather than truncating",
    monthlyAmountMinor({ amountMinor: 10000, interval: "yearly" }) === 833,
    String(monthlyAmountMinor({ amountMinor: 10000, interval: "yearly" }))
  );

  // ---------------------------------------------------------------------------
  section("Subscriptions accrue, usage is spent once");
  // ---------------------------------------------------------------------------

  {
    // $39/mo since June = June, July, August = 3 months.
    const summary = summarizeSpend([cost()], NOW);
    check("three months of a monthly plan", summary.subscriptionTotalMinor === 11700, String(summary.subscriptionTotalMinor));
    check("the run rate is one month", summary.monthlyRunRateMinor === 3900);
    check("this month is one month", summary.thisMonthMinor === 3900);
    check("one active subscription", summary.activeSubscriptions === 1);
  }

  {
    const usage = cost({ kind: "usage", vendor: "Brave Search", amountMinor: 500, interval: null, units: 1000, unitLabel: "searches", startedAt: "2026-08-10T00:00:00.000Z" });
    const summary = summarizeSpend([usage], NOW);
    check("usage counts once, not per month", summary.usageTotalMinor === 500, String(summary.usageTotalMinor));
    check("and does not create a run rate", summary.monthlyRunRateMinor === 0);
    check("usage this month is counted", summary.thisMonthMinor === 500);
  }

  {
    // Usage from a previous month is in the total but not in this month.
    const old = cost({ kind: "usage", amountMinor: 500, interval: null, startedAt: "2026-07-02T00:00:00.000Z" });
    const summary = summarizeSpend([old], NOW);
    check("older usage is still in the total", summary.totalMinor === 500);
    check("but not in this month", summary.thisMonthMinor === 0, String(summary.thisMonthMinor));
  }

  {
    // A cancelled subscription stops accruing.
    const cancelled = cost({ startedAt: "2026-06-01T00:00:00.000Z", endedAt: "2026-07-15T00:00:00.000Z" });
    const summary = summarizeSpend([cancelled], NOW);
    check("a cancelled plan stops at cancellation", summary.subscriptionTotalMinor === 7800, String(summary.subscriptionTotalMinor));
    check("and leaves no run rate", summary.monthlyRunRateMinor === 0);
    check("and is not counted as active", summary.activeSubscriptions === 0);
    check("and adds nothing to this month", summary.thisMonthMinor === 0);
  }

  {
    // A subscription starting in the future has not cost anything yet.
    const future = cost({ startedAt: "2026-12-01T00:00:00.000Z" });
    const summary = summarizeSpend([future], NOW);
    check("a future subscription is not active", summary.activeSubscriptions === 0);
    check("and does not add to the run rate", summary.monthlyRunRateMinor === 0);
  }

  {
    const summary = summarizeSpend(
      [cost(), cost({ kind: "usage", amountMinor: 500, interval: null, startedAt: "2026-08-10T00:00:00.000Z" })],
      NOW
    );
    check("the total is subscriptions plus usage", summary.totalMinor === 12200, String(summary.totalMinor));
    check("this month is the fee plus the top-up", summary.thisMonthMinor === 4400, String(summary.thisMonthMinor));
  }

  check("no entries is zero, not an error", summarizeSpend([], NOW).totalMinor === 0);

  // ---------------------------------------------------------------------------
  section("Mixed currencies are refused, not guessed");
  // ---------------------------------------------------------------------------

  {
    const summary = summarizeSpend([cost(), cost({ currency: "GBP", amountMinor: 3000 })], NOW);
    check("a mixed-currency set is flagged", summary.mixedCurrencies);
    check(
      "and no total is invented",
      summary.totalMinor === 0,
      "converting would need a rate, and a made-up rate on a transparency page is the worst kind of wrong"
    );
  }
  check("a single currency is not flagged", !summarizeSpend([cost(), cost()], NOW).mixedCurrencies);
  check("case does not create a false mismatch", !summarizeSpend([cost({ currency: "usd" }), cost()], NOW).mixedCurrencies);

  // ---------------------------------------------------------------------------
  section("What a lead costs");
  // ---------------------------------------------------------------------------

  {
    // $122.00 across 77,325 leads, 34,000 ready, 11,777 qualified.
    const per = costPerLead(12200, { total: 77325, ready: 34000, qualified: 11777 });
    check("per lead is a fraction of a cent", per.perLeadMinor === 0, String(per.perLeadMinor));
    check("per ready lead is larger", (per.perReadyLeadMinor ?? 0) >= (per.perLeadMinor ?? 0));
    check("per qualified lead is the largest", (per.perQualifiedLeadMinor ?? 0) === 1, String(per.perQualifiedLeadMinor));
  }

  {
    const per = costPerLead(12200, { total: 0, ready: 0, qualified: 0 });
    check(
      "no leads gives null, not zero",
      per.perLeadMinor === null && per.perReadyLeadMinor === null && per.perQualifiedLeadMinor === null,
      "an undefined ratio is not the same as free"
    );
  }

  // ---------------------------------------------------------------------------
  section("Formatting");
  // ---------------------------------------------------------------------------

  check("dollars and cents", formatMoney(3900, "USD") === "$39.00", formatMoney(3900, "USD"));
  check("cents are padded", formatMoney(3905, "USD") === "$39.05", formatMoney(3905, "USD"));
  check("a lone cent", formatMoney(1, "USD") === "$0.01", formatMoney(1, "USD"));
  check("thousands are separated", formatMoney(123456, "USD") === "$1,234.56", formatMoney(123456, "USD"));
  check("pounds", formatMoney(3900, "GBP") === "£39.00");
  check("euros", formatMoney(3900, "EUR") === "€39.00");
  check("zero", formatMoney(0, "USD") === "$0.00");

  check(
    "half a cent does not render as free",
    formatUnitCost(0.5, "USD") !== "$0.00",
    formatUnitCost(0.5, "USD")
  );
  check("a null unit cost is a dash", formatUnitCost(null, "USD") === "—");
  check("a real amount formats normally", formatUnitCost(3900, "USD") === "$39.00");

  // ---------------------------------------------------------------------------
  section("Unit cost");
  // ---------------------------------------------------------------------------

  {
    const entry = cost({ kind: "usage", amountMinor: 500, interval: null, units: 1000, unitLabel: "searches" });
    check("$5 for 1,000 searches is half a cent each", unitCostMinor(entry) === 0.5, String(unitCostMinor(entry)));
  }
  check("no units gives null", unitCostMinor(cost({ units: null })) === null);
  check("zero units gives null rather than dividing by zero", unitCostMinor(cost({ units: 0 })) === null);

  // ---------------------------------------------------------------------------
  section("Parsing what the owner types");
  // ---------------------------------------------------------------------------

  // The obvious implementation, Math.round(Number(x) * 100), is wrong: binary
  // floating point makes 19.99 * 100 into 1998.9999999999998, and the same
  // trick loses a penny on other values. These cases exist so the safe
  // string-splitting version is never "simplified" back to the broken one.
  const cases: [string, number | null][] = [
    ["39", 3900],
    ["39.00", 3900],
    ["$39", 3900],
    ["£39.50", 3950],
    ["1,234.56", 123456],
    ["0.01", 1],
    ["19.99", 1999],
    ["0.5", 50],
    ["  39  ", 3900],
    ["5.555", 555],
    ["", null],
    ["abc", null],
    ["3.9.9", null],
  ];
  for (const [input, expected] of cases) {
    const got = parseAmount(input);
    check(
      `"${input}" -> ${expected === null ? "rejected" : expected}`,
      got === expected,
      `got ${got}`
    );
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\nFailures:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
}

main();
