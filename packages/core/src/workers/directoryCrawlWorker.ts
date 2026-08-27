import type { SiteFetcher } from "../enrichment/siteFetcher";
import type { DirectoryPlatform } from "../enrichment/bookingDirectory";
import { extractCandidatesFromHtml } from "../enrichment/bookingDirectory";
import {
  coverageKey,
  extractCityIds,
  listingUrlFor,
  slugify,
  type DirectoryCrawl,
  type DirectoryListing,
  type ListingConfig,
} from "../enrichment/directoryIndex";

/**
 * Reads one platform's directory for one town and trade, and records both what
 * it found and whether it managed to finish.
 *
 * The second half is the important half. A crawl that half-worked must be
 * recorded as failed, because a partial index is indistinguishable from a
 * complete one at lookup time, and a business missing from a partial index
 * would be reported as not being on the platform. That is the single most
 * expensive mistake this system can make: it hands out the largest positive
 * factor in the scoring model to a business that has an incumbent, and the
 * owner finds out by ringing them.
 */

export interface CrawlResult {
  crawl: DirectoryCrawl;
  listings: DirectoryListing[];
  /** The URL shape that worked, so a list of candidates can be trimmed to the answer. */
  usedTemplate: string | null;
}

export interface CrawlScope {
  city: string;
  state: string;
  industry: string;
}

export interface CrawlDeps {
  fetcher: SiteFetcher;
  listing: ListingConfig;
  now: string;
  newId: () => string;
  /** Discovered town ids for this platform, keyed by town slug. */
  cityIds?: Map<string, string>;
  /** Pause between page fetches. Politeness, and it keeps us under rate limits. */
  delayMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function crawlDirectory(
  platform: DirectoryPlatform,
  scope: CrawlScope,
  deps: CrawlDeps
): Promise<CrawlResult> {
  const id = coverageKey({ platform: platform.id, ...scope });
  const base = { id, platform: platform.id, city: scope.city, state: scope.state, industry: scope.industry };
  const failed = (detail: string, pagesRead = 0): CrawlResult => ({
    crawl: { ...base, status: "failed", listingsFound: 0, pagesRead, detail, crawledAt: deps.now },
    listings: [],
    usedTemplate: null,
  });

  const cityId = deps.cityIds?.get(slugify(scope.city)) ?? null;

  /**
   * Which candidate URL shape actually works for this platform.
   *
   * Page one is fetched against each shape in turn until one yields profile
   * links, and everything after that uses the winner. Only page one pays for
   * the search: once a shape is known good, paging follows it directly.
   */
  let templateIndex = -1;
  const firstPageAttempts: string[] = [];

  for (let candidate = 0; candidate < deps.listing.urlTemplates.length; candidate += 1) {
    const url = listingUrlFor(deps.listing, { ...scope, cityId }, deps.listing.firstPage, candidate);
    if (!url) {
      firstPageAttempts.push(
        `shape ${candidate + 1}: no URL — ${platform.label} addresses towns by an id and ${scope.city}'s is unknown`
      );
      continue;
    }

    if (candidate > 0 && deps.delayMs) await sleep(deps.delayMs);
    const probe = await deps.fetcher.fetchPage(url);

    if (probe.error) {
      firstPageAttempts.push(`${url} — ${probe.error}`);
      continue;
    }
    if (probe.status === 403 || probe.status === 429) {
      // A refusal is not a wrong URL, and trying the next shape would just be
      // more traffic to somewhere already turning us away.
      return failed(`${platform.label} refused the request (HTTP ${probe.status}).`, 1);
    }
    if (probe.status >= 400) {
      firstPageAttempts.push(`${url} — HTTP ${probe.status}`);
      continue;
    }
    if (extractCandidatesFromHtml(probe.html, probe.finalUrl, platform, 200).length === 0) {
      firstPageAttempts.push(`${url} — 200 but no profile links in it`);
      continue;
    }

    templateIndex = candidate;
    break;
  }

  if (templateIndex === -1) {
    return failed(`No working directory URL for ${scope.city}. Tried: ${firstPageAttempts.join(" | ")}`, 0);
  }

  const listings: DirectoryListing[] = [];
  const seenUrls = new Set<string>();
  let pagesRead = 0;

  for (let page = deps.listing.firstPage; page < deps.listing.firstPage + deps.listing.maxPages; page += 1) {
    const url = listingUrlFor(deps.listing, { ...scope, cityId }, page, templateIndex);
    if (!url) break;

    if (pagesRead > 0 && deps.delayMs) await sleep(deps.delayMs);

    const fetched = await deps.fetcher.fetchPage(url);

    if (fetched.error) {
      // Anything already collected is discarded along with the crawl. Keeping
      // page one of five and calling it a complete index is exactly how a
      // business on page three gets reported as not being on the platform.
      return failed(`${url} — ${fetched.error}`, pagesRead);
    }
    if (fetched.status === 403 || fetched.status === 429) {
      return failed(`${platform.label} refused the request (HTTP ${fetched.status}).`, pagesRead);
    }
    if (fetched.status >= 400) {
      // On page one, any error means the URL shape is wrong.
      if (page === deps.listing.firstPage) {
        return failed(`HTTP ${fetched.status} — the directory URL for ${platform.label} looks wrong.`, pagesRead);
      }
      // Later on, ONLY "there is no such page" is a normal way for a directory
      // to end. Anything else is a fault, and treating a 500 on page three as
      // the end of the town would quietly publish a third of an index as a
      // whole one — after which every business on the missing pages reads as
      // not being on the platform.
      if (fetched.status === 404 || fetched.status === 410) break;
      return failed(
        `HTTP ${fetched.status} on page ${page} of ${scope.city} — the directory was only partly readable.`,
        pagesRead
      );
    }

    // A directory page carries dozens of listings, so the per-page cap that
    // suits a search-results page would silently truncate this one.
    const candidates = extractCandidatesFromHtml(fetched.html, fetched.finalUrl, platform, 200);

    if (candidates.length === 0) {
      if (page === deps.listing.firstPage) {
        return failed(
          `${platform.label}'s directory for ${scope.city} returned no profile links — the page is probably drawn by script, or the profile pattern is wrong.`,
          pagesRead + 1
        );
      }
      // Ran off the end of the directory. That is how it finishes.
      pagesRead += 1;
      break;
    }

    let newOnThisPage = 0;
    for (const candidate of candidates) {
      if (seenUrls.has(candidate.url)) continue;
      seenUrls.add(candidate.url);
      newOnThisPage += 1;
      listings.push({
        id: deps.newId(),
        platform: platform.id,
        city: scope.city,
        state: scope.state,
        industry: scope.industry,
        businessName: candidate.name,
        profileUrl: candidate.url,
        crawledAt: deps.now,
      });
    }

    pagesRead += 1;

    // Every listing repeated from the previous page means paging is not
    // working — many directories ignore an unknown page parameter and serve
    // page one forever. Stopping here is right; looping is not.
    if (newOnThisPage === 0) break;
  }

  return {
    crawl: {
      ...base,
      status: "complete",
      listingsFound: listings.length,
      pagesRead,
      detail: null,
      crawledAt: deps.now,
    },
    listings,
    usedTemplate: deps.listing.urlTemplates[templateIndex] ?? null,
  };
}

/**
 * Discovers a platform's town ids from its own index of towns.
 *
 * Only needed by platforms whose directory URLs carry an opaque id. Returns an
 * empty map on any failure rather than throwing: every town then reports "no
 * URL could be built" and stays unknown, which is the honest outcome.
 */
export async function discoverCityIds(
  listing: ListingConfig,
  industry: string,
  fetcher: SiteFetcher
): Promise<{ ids: Map<string, string>; error: string | null; source: string | null }> {
  if (!listing.cityIndex) return { ids: new Map(), error: null, source: null };

  const slug = listing.industrySlugs?.[industry] ?? industry.replace(/s$/, "");
  const attempts: string[] = [];

  /**
   * Each candidate page in turn, keeping the first that actually yields ids.
   *
   * The first guess — the platform's own category page — turned out not to
   * link to town pages at all, and there was no way to discover that except by
   * asking it. Rather than guess again, this tries the handful of places a
   * town index plausibly lives and reports which one worked, so the config can
   * be trimmed to the answer instead of to another guess.
   */
  for (const template of listing.cityIndex.urlTemplates) {
    const url = template.replace("{industry}", slug);
    const page = await fetcher.fetchPage(url);

    if (page.error) {
      attempts.push(`${url} — ${page.error}`);
      continue;
    }
    if (page.status >= 400) {
      attempts.push(`${url} — HTTP ${page.status}`);
      continue;
    }

    const ids = extractCityIds(page.html, listing.cityIndex.cityLinkPatterns);
    if (ids.size > 0) return { ids, error: null, source: url };

    attempts.push(`${url} — 200 but no town ids in it`);
  }

  return { ids: new Map(), error: attempts.join(" | "), source: null };
}
