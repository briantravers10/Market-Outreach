import type { SearchApiResult, SearchApiTransport, SpendGuard } from "./directoryLookups";
import type { CostEntry, CostRepository } from "../spend/types";
import { summarizeSpend } from "../spend/spendService";

/**
 * The paid search backend, and the thing that stops it running away with money.
 *
 * Kept separate from the lookup that uses it so the lookup can be tested
 * without a key, a network, or a bill.
 */

/** Brave's web-search API. Roughly $5 per 1,000 queries at the time of writing. */
export function createBraveTransport(
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): SearchApiTransport {
  return async (query: string) => {
    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      // Ten is plenty: the business is either in the first few results for a
      // site-scoped query or it is not there at all, and asking for more costs
      // the same but takes longer.
      url.searchParams.set("count", "10");

      const response = await fetchImpl(url.toString(), {
        headers: {
          accept: "application/json",
          // Header auth, so the key never lands in a URL that could be logged.
          "x-subscription-token": apiKey,
        },
      });

      if (!response.ok) {
        // The key must never appear in an error string that reaches a page.
        return { ok: false, results: [], error: `Search API returned HTTP ${response.status}.` };
      }

      const body = (await response.json()) as { web?: { results?: unknown[] } };
      const raw = Array.isArray(body.web?.results) ? body.web.results : [];

      const results: SearchApiResult[] = raw
        .map((item) => {
          const entry = item as Record<string, unknown>;
          return {
            url: typeof entry.url === "string" ? entry.url : "",
            title: typeof entry.title === "string" ? entry.title : "",
            description: typeof entry.description === "string" ? entry.description : "",
          };
        })
        .filter((r) => r.url);

      return { ok: true, results, error: null };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return { ok: false, results: [], error: message };
    }
  };
}

/**
 * A hard ceiling on spending, checked before every paid call.
 *
 * The cap is on the total already recorded, so it holds across restarts and
 * across however many workers are running — the database is the shared truth
 * rather than a counter in one process's memory.
 *
 * Individual searches are batched into one cost entry rather than written one
 * per lookup. Forty-three thousand rows of half a cent each would make the
 * spend page unreadable and slow, and the owner wants to know what the run
 * cost, not to audit each query.
 */
export class RecordingSpendGuard implements SpendGuard {
  private pendingMinor = 0;
  private pendingSearches = 0;
  private cachedSpentMinor: number | null = null;

  constructor(
    private readonly costs: CostRepository,
    private readonly capMinor: number,
    private readonly vendor: string,
    private readonly newId: () => string,
    private readonly now: () => string,
    /** Write a cost entry after this many searches. */
    private readonly flushEvery = 200
  ) {}

  /** Everything spent so far, including what this run has not yet written. */
  private async spentMinor(): Promise<number> {
    if (this.cachedSpentMinor === null) {
      const entries = await this.costs.list();
      // Only this vendor's spend counts against this cap; a Pipedrive
      // subscription is not a reason to stop looking leads up.
      const mine = entries.filter((e) => e.vendor === this.vendor);
      this.cachedSpentMinor = summarizeSpend(mine, this.now()).totalMinor;
    }
    return this.cachedSpentMinor + this.pendingMinor;
  }

  async canSpend(minorUnits: number): Promise<boolean> {
    if (this.capMinor <= 0) return false;
    return (await this.spentMinor()) + minorUnits <= this.capMinor;
  }

  async record(minorUnits: number, detail: { query: string; platform: string }): Promise<void> {
    this.pendingMinor += minorUnits;
    this.pendingSearches += 1;
    if (this.pendingSearches >= this.flushEvery) await this.flush(detail.platform);
  }

  /** Writes what this run has spent so far. Safe to call repeatedly. */
  async flush(lastPlatform = "several platforms"): Promise<void> {
    if (this.pendingSearches === 0) return;

    const entry: CostEntry = {
      id: this.newId(),
      kind: "usage",
      vendor: this.vendor,
      description: `${this.pendingSearches.toLocaleString()} booking-platform lookups (${lastPlatform} and others)`,
      // Rounded up: a partial cent still appears on a bill, and understating
      // spend on the page that exists to be honest about spend is the wrong
      // direction to be wrong in.
      amountMinor: Math.ceil(this.pendingMinor),
      currency: "USD",
      interval: null,
      startedAt: this.now(),
      endedAt: null,
      units: this.pendingSearches,
      unitLabel: "searches",
      automatic: true,
      createdAt: this.now(),
    };

    await this.costs.upsert(entry);
    this.cachedSpentMinor = (this.cachedSpentMinor ?? 0) + entry.amountMinor;
    this.pendingMinor = 0;
    this.pendingSearches = 0;
  }

  /** What this run has spent but not yet written, for a progress line. */
  get pendingMinorUnits(): number {
    return this.pendingMinor;
  }
}
