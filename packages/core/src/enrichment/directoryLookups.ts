import type { Lead } from "../types";
import type { SiteFetcher } from "./siteFetcher";
import {
  buildSearchQuery,
  extractCandidatesFromHtml,
  pickMatch,
  searchUrlFor,
  type DirectoryLookup,
  type DirectoryOutcome,
  type DirectoryPlatform,
  type MatchOptions,
} from "./bookingDirectory";

/**
 * Two ways to ask whether a business is on a booking platform, behind one
 * interface so switching between them is a config change rather than a
 * rewrite. The owner's instruction was explicit: try the platforms directly,
 * and move to paid search if they block us.
 */

// ---------------------------------------------------------------------------
// Direct
// ---------------------------------------------------------------------------

/**
 * Fetches the platform's own public search page.
 *
 * Free, and fragile in two specific ways that both have to be reported rather
 * than swallowed. These sites change their markup whenever they like, and they
 * block automated traffic — and a blocked request that returned "not listed"
 * would mark the business as having no online booking, handing out points for
 * a finding we never made. Every failure mode here ends in `unavailable`.
 */
export class DirectDirectoryLookup implements DirectoryLookup {
  readonly name = "direct";

  constructor(
    private readonly fetcher: SiteFetcher,
    private readonly match: MatchOptions
  ) {}

  available(): boolean {
    return true;
  }

  async search(lead: Lead, platform: DirectoryPlatform): Promise<DirectoryOutcome> {
    const url = searchUrlFor(platform, buildSearchQuery(lead));
    const page = await this.fetcher.fetchPage(url);

    if (page.error) {
      return { kind: "unavailable", platform: platform.id, reason: page.error };
    }
    if (page.status === 403 || page.status === 429) {
      return {
        kind: "unavailable",
        platform: platform.id,
        reason: `${platform.label} refused the request (HTTP ${page.status}) — automated access is blocked.`,
      };
    }
    if (page.status >= 400) {
      // Very likely the URL template is wrong rather than the business absent.
      return {
        kind: "unavailable",
        platform: platform.id,
        reason: `HTTP ${page.status} — the search URL for ${platform.label} may be out of date.`,
      };
    }
    if (!page.html.trim()) {
      return { kind: "unavailable", platform: platform.id, reason: "Empty response." };
    }

    const candidates = extractCandidatesFromHtml(page.html, page.finalUrl, platform);

    // Nothing that even looks like a profile link means we probably failed to
    // read the page rather than that the business is absent. A search results
    // page with zero results still normally contains OTHER profile links.
    if (candidates.length === 0) {
      return {
        kind: "unavailable",
        platform: platform.id,
        reason: `No profile links found on ${platform.label}'s results page — the page shape has probably changed, or the response was rendered by script.`,
      };
    }

    const matched = pickMatch(lead, candidates, this.match);
    if (!matched) return { kind: "not_listed", platform: platform.id };

    return {
      kind: "found",
      platform: platform.id,
      profileUrl: matched.candidate.url,
      matchedName: matched.candidate.name,
      similarity: matched.similarity,
    };
  }
}

// ---------------------------------------------------------------------------
// Paid search
// ---------------------------------------------------------------------------

export interface SearchApiResult {
  url: string;
  title: string;
  description: string;
}

/** The seam the paid provider plugs into, so this is testable without spending money. */
export interface SearchApiTransport {
  (query: string): Promise<{ ok: boolean; results: SearchApiResult[]; error: string | null }>;
}

/** Told before each call whether there is budget left, and what the call cost after. */
export interface SpendGuard {
  canSpend(minorUnits: number): Promise<boolean>;
  record(minorUnits: number, detail: { query: string; platform: string }): Promise<void>;
}

/**
 * Asks a search engine what it already knows, rather than asking the platform.
 *
 * Legal, stable, and it does not touch the platforms' servers at all — the
 * index has already been built. The trade is that it costs about half a cent
 * per lookup, so every call goes through a spending guard first and records
 * what it cost afterwards.
 */
export class SearchApiDirectoryLookup implements DirectoryLookup {
  readonly name = "search-api";

  constructor(
    private readonly transport: SearchApiTransport | null,
    private readonly match: MatchOptions,
    private readonly costPerSearchMinor: number,
    private readonly guard: SpendGuard | null = null
  ) {}

  available(): boolean {
    return this.transport !== null;
  }

  async search(lead: Lead, platform: DirectoryPlatform): Promise<DirectoryOutcome> {
    if (!this.transport) {
      return { kind: "unavailable", platform: platform.id, reason: "No search API key configured." };
    }

    if (this.guard && !(await this.guard.canSpend(this.costPerSearchMinor))) {
      // Stopping short of the cap is the whole point of having one. Reported
      // as unavailable so no lead is wrongly marked as having no booking.
      return {
        kind: "unavailable",
        platform: platform.id,
        reason: "Spending cap reached — raise it on the Spend page to continue.",
      };
    }

    const query = `site:${platform.domain} ${buildSearchQuery(lead)}`;
    const response = await this.transport(query);

    // Recorded whether or not it found anything: a search that returns nothing
    // still costs the same, and a spend page that only counts successful
    // lookups would understate the bill.
    await this.guard?.record(this.costPerSearchMinor, { query, platform: platform.id });

    if (!response.ok) {
      return { kind: "unavailable", platform: platform.id, reason: response.error ?? "Search failed." };
    }

    const candidates = response.results
      .filter((result) => {
        try {
          return new URL(result.url).hostname.endsWith(platform.domain);
        } catch {
          return false;
        }
      })
      .map((result) => ({
        url: result.url,
        // A result title is normally "Business Name | Booksy"; the tail is the
        // platform's own branding and would drag every similarity score down.
        name: result.title.split(/[|·—–]/)[0].trim(),
        locationText: `${result.title} ${result.description}`,
      }));

    if (candidates.length === 0) {
      // The engine answered and had nothing on this domain. That IS evidence.
      return { kind: "not_listed", platform: platform.id };
    }

    const matched = pickMatch(lead, candidates, this.match);
    if (!matched) return { kind: "not_listed", platform: platform.id };

    return {
      kind: "found",
      platform: platform.id,
      profileUrl: matched.candidate.url,
      matchedName: matched.candidate.name,
      similarity: matched.similarity,
    };
  }
}

/**
 * Tries each lookup in turn until one gives a real answer.
 *
 * The order is the owner's: free first, paid only when the free one cannot
 * answer. An `unavailable` from the direct lookup — blocked, or markup we
 * could not read — is exactly the case worth paying for. A `not_listed` is a
 * real answer and stops the chain, because paying to re-confirm it would be
 * spending money to learn nothing.
 */
export async function lookupWithFallback(
  lead: Lead,
  platform: DirectoryPlatform,
  lookups: DirectoryLookup[]
): Promise<{ outcome: DirectoryOutcome; via: string; attempts: string[] }> {
  const attempts: string[] = [];
  let last: DirectoryOutcome = { kind: "unavailable", platform: platform.id, reason: "No lookup configured." };
  let via = "none";

  for (const lookup of lookups) {
    if (!lookup.available()) continue;
    attempts.push(lookup.name);
    const outcome = await lookup.search(lead, platform);
    via = lookup.name;
    if (outcome.kind !== "unavailable") return { outcome, via, attempts };
    last = outcome;
  }

  return { outcome: last, via, attempts };
}
