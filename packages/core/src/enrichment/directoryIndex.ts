import type { Lead } from "../types";
import type { DirectoryCandidate, DirectoryPlatform, MatchOptions } from "./bookingDirectory";
import { pickMatch } from "./bookingDirectory";

/**
 * Asking a booking platform who is on it in a given town, once, instead of
 * asking about one business at a time.
 *
 * The first design searched each platform per business. It could not work,
 * and the reason is worth writing down: these platforms have no per-business
 * search URL. What they publish is a directory — "hair salons in Miami" — one
 * page per town and trade, server-rendered because they want it in Google.
 * Forty-three thousand per-business lookups against a URL shape that does not
 * exist produced forty-three thousand 404s.
 *
 * Read the directory once per town and trade, and the same question is
 * answered for every lead in it — free, and it gets cheaper per lead as more
 * leads arrive rather than more expensive.
 *
 * The discipline from the per-business version carries over unchanged and is
 * the thing to protect: a town whose directory we failed to read must leave
 * its businesses UNKNOWN. Absence from an index we never built is not
 * evidence of absence from the platform.
 */

/** One business found on a platform's directory page for a town. */
export interface DirectoryListing {
  id: string;
  platform: string;
  city: string;
  state: string;
  industry: string;
  businessName: string;
  profileUrl: string;
  crawledAt: string;
}

/**
 * Whether a town-and-trade has been read on a platform, and how it went.
 *
 * This table is what makes a NONE safe to record. Without it the matcher
 * cannot tell "we read Miami's hair salons and they are not there" from "we
 * never read Miami", and those two must never produce the same answer.
 */
export interface DirectoryCrawl {
  /** platform:state:city:industry, lower-cased. Deterministic so a re-crawl replaces rather than duplicates. */
  id: string;
  platform: string;
  city: string;
  state: string;
  industry: string;
  status: "complete" | "failed";
  listingsFound: number;
  pagesRead: number;
  /** Why it failed, in words, for the dashboard. Null when complete. */
  detail: string | null;
  crawledAt: string;
}

export interface DirectoryIndexRepository {
  putListings(listings: DirectoryListing[]): Promise<number>;
  listingsFor(scope: { platform: string; city: string; state: string; industry: string }): Promise<DirectoryListing[]>;
  recordCrawl(crawl: DirectoryCrawl): Promise<void>;
  getCrawl(id: string): Promise<DirectoryCrawl | null>;
  /** Crawls for one town-and-trade across every platform, for the coverage check. */
  crawlsFor(scope: { city: string; state: string; industry: string }): Promise<DirectoryCrawl[]>;
  countListings(): Promise<number>;
  countCrawls(status?: "complete" | "failed"): Promise<number>;
}

/** How a platform's town directory is addressed. */
export interface ListingConfig {
  /** Placeholders: {industry} {city} {state} {cityId}. */
  urlTemplate: string;
  /** Query parameter for page 2 and beyond. Null when the directory is a single page. */
  pageParam: string | null;
  /** Page numbering starts here — some platforms are 0-based. */
  firstPage: number;
  maxPages: number;
  /** Our industry id -> the platform's own slug, where they differ. */
  industrySlugs?: Record<string, string>;
  /**
   * Platforms whose directory URL carries an opaque town id rather than a
   * slug. The id has to be discovered from the platform's own index of towns
   * before any directory page can be addressed.
   */
  cityIndex?: {
    /**
     * Pages that might list towns, tried in order until one yields ids.
     *
     * A list rather than one URL because the first guess was wrong and there
     * is no way to find the right one from here: Booksy's category page turns
     * out not to link to its town pages at all, so nothing could learn that
     * Miami is 15889. Trying a few plausible places — the category page, the
     * sitemaps a platform publishes for search engines — and reporting which
     * one worked lets production answer a question this sandbox cannot.
     */
    urlTemplates: string[];
    /**
     * Shapes that carry a town id, tried against each page.
     *
     * More than one because the id appears in two places on these sites: in a
     * town's own directory URL (/s/hair-salon/15889_miami) and in every
     * business profile URL (/940574_luxe-beauty_hair-salon_15889_miami). The
     * second matters — a page with no town links at all may still be covered
     * in profile links, and each one names its town.
     *
     * Each must capture the id first and the town slug second.
     */
    cityLinkPatterns: string[];
  };
}

/**
 * URL-safe form of a town or trade name.
 *
 * Accents are stripped rather than percent-encoded because these platforms
 * slug them away too — Coral Gables and Kendall are unremarkable, but Florida
 * is full of names like Cañada and Islamorada, and a percent-encoded slug
 * matches nothing.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The platform's word for one of our trades.
 *
 * Falls back to dropping a trailing "s" from our own id, which is right more
 * often than it has any business being: both platforms seen so far use the
 * singular ("hair-salon" for our "hair-salons"). An explicit mapping in config
 * wins wherever that guess is wrong.
 */
export function industrySlugFor(config: ListingConfig, industry: string): string {
  const explicit = config.industrySlugs?.[industry];
  if (explicit) return explicit;
  return industry.replace(/s$/, "");
}

/** The deterministic key for one town-and-trade on one platform. */
export function coverageKey(scope: {
  platform: string;
  city: string;
  state: string;
  industry: string;
}): string {
  return [scope.platform, scope.state, slugify(scope.city), scope.industry]
    .map((part) => part.toLowerCase())
    .join(":");
}

export interface ListingUrlScope {
  city: string;
  state: string;
  industry: string;
  /** Required only by platforms whose template uses {cityId}. */
  cityId?: string | null;
}

/**
 * The directory URL for one town and trade, or null when it cannot be built.
 *
 * Null rather than a guessed URL: a template that wants a town id we have not
 * discovered yet would otherwise produce a URL with the literal text
 * "{cityId}" in it, which 404s and looks for all the world like the town
 * having no listings.
 */
export function listingUrlFor(
  config: ListingConfig,
  scope: ListingUrlScope,
  page?: number
): string | null {
  const needsCityId = config.urlTemplate.includes("{cityId}");
  if (needsCityId && !scope.cityId) return null;

  const url = config.urlTemplate
    .replace("{industry}", industrySlugFor(config, scope.industry))
    .replace("{city}", slugify(scope.city))
    .replace("{state}", scope.state.toLowerCase())
    .replace("{cityId}", scope.cityId ?? "");

  if (page === undefined || page === config.firstPage || !config.pageParam) return url;

  try {
    const parsed = new URL(url);
    parsed.searchParams.set(config.pageParam, String(page));
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Town ids and slugs from a platform's own index of towns.
 *
 * Matched by URL shape rather than by markup, for the same reason the profile
 * extractor is: a redesign changes classes constantly and URL shapes almost
 * never.
 */
export function extractCityIds(html: string, patterns: string | string[]): Map<string, string> {
  const found = new Map<string, string>();

  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "g");
    } catch {
      // A bad pattern in config yields no ids, so every affected town reports
      // "could not build a URL" and stays unknown. It must not throw, and it
      // must not stop the other patterns from being tried.
      continue;
    }

    for (const match of html.matchAll(regex)) {
      const [, id, slug] = match;
      if (!id || !slug) continue;
      // First one wins: a page links the same town from several places, and
      // earlier patterns are the more specific ones.
      if (!found.has(slug)) found.set(slug, id);
    }
  }

  return found;
}

/** What the index can say about one business. */
export type IndexVerdict =
  | { kind: "listed"; platform: string; profileUrl: string; matchedName: string }
  | { kind: "not-listed"; platform: string }
  | { kind: "no-index"; platform: string; reason: string };

/**
 * Looks one business up in an index already built for its town.
 *
 * Nothing is fetched here. Either the town was read, in which case this is a
 * real answer, or it was not, in which case the answer is that we do not know.
 */
export function lookupInIndex(
  lead: Pick<Lead, "businessName" | "city" | "state" | "zip">,
  platform: DirectoryPlatform,
  crawl: DirectoryCrawl | null,
  listings: DirectoryListing[],
  match: MatchOptions
): IndexVerdict {
  if (!crawl) {
    return {
      kind: "no-index",
      platform: platform.id,
      reason: `${platform.label} has not been read for ${lead.city} yet.`,
    };
  }
  if (crawl.status !== "complete") {
    return {
      kind: "no-index",
      platform: platform.id,
      reason: `${platform.label}'s directory for ${lead.city} could not be read — ${crawl.detail ?? "no detail"}.`,
    };
  }

  const candidates: DirectoryCandidate[] = listings.map((listing) => ({
    url: listing.profileUrl,
    name: listing.businessName,
    // The town is already established by which index this is, so it is
    // supplied rather than parsed out of a URL. Without it every candidate
    // would fail a city check that the index has in fact already passed.
    locationText: `${listing.businessName} ${listing.city} ${listing.state}`,
  }));

  const matched = pickMatch(lead, candidates, match);
  if (!matched) return { kind: "not-listed", platform: platform.id };

  return {
    kind: "listed",
    platform: platform.id,
    profileUrl: matched.candidate.url,
    matchedName: matched.candidate.name,
  };
}
