import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import {
  HttpSiteFetcher,
  coverageKey,
  crawlDirectory,
  discoverCityIds,
  getBookingDirectories,
  logActivity,
  resolveBatchSize,
} from "@market-outreach/core";
import { getRepos } from "../../../../lib/data";
import { isDemoMode } from "../../../../lib/demo";

/**
 * Reads the booking platforms' town directories, one town and trade at a time.
 *
 * This replaced a per-business search that could not have worked. These
 * platforms publish a directory — "hair salons in Miami" — and no per-business
 * search URL at all, so forty-three thousand per-business lookups produced
 * forty-three thousand 404s. Reading a town once answers the question for
 * every lead in it, and the cost per lead falls as leads are added rather than
 * rising.
 *
 * Deliberately unhurried. There are a few thousand town-and-trade pairs, this
 * runs every fifteen minutes, and there is a pause between page fetches. The
 * index is worth having in a week and worth nothing at all if hammering these
 * sites gets us blocked in an hour.
 *
 * Auth: CRON_SECRET.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Town-and-trade pairs per run. Small: each is up to eight page fetches. */
const DEFAULT_BATCH = 6;
const WORK_DEADLINE_MS = 210_000;
/** Between page fetches on the same platform. Politeness, and it keeps us under their rate limits. */
const PAGE_DELAY_MS = 1_500;

/**
 * How long an index stays good.
 *
 * Businesses join and leave these platforms slowly, and a directory read last
 * week is a fine answer today. Re-reading sooner would spend the whole budget
 * refreshing towns that already have answers while towns nobody has read wait.
 */
const INDEX_FRESH_DAYS = 45;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set, so this endpoint refuses to run." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isDemoMode) {
    return NextResponse.json({ error: "The demo database is a read-only snapshot." }, { status: 403 });
  }

  const repos = getRepos();
  const directories = getBookingDirectories();
  const platforms = directories.platforms.filter((p) => p.enabled && p.listing);
  if (platforms.length === 0) {
    return NextResponse.json({ error: "No platform has a directory URL configured." }, { status: 503 });
  }

  const batchSize = resolveBatchSize(request.nextUrl.searchParams.get("batch"), DEFAULT_BATCH, 40);
  const now = new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - INDEX_FRESH_DAYS * 86_400_000).toISOString();
  const fetcher = new HttpSiteFetcher(12_000);
  const startedAt = Date.now();

  // Pull generously and filter to what still needs reading. Asking the
  // database for "scopes without a fresh crawl" would need a join against a
  // table it does not know about; asking for the busiest few hundred and
  // skipping the done ones costs one query and stays simple.
  const scopes = await repos.leads.directoryScopes(batchSize * 40);

  /**
   * Town ids, discovered once per platform-and-trade and reused.
   *
   * Booksy addresses towns by an opaque number — /s/hair-salon/15889_miami —
   * which has to be read off its own index of towns before any directory page
   * can be requested. Discovering that per town would be one extra fetch per
   * town for information one page already carries in full.
   */
  const cityIdCache = new Map<string, Map<string, string>>();
  const discoveryErrors: string[] = [];
  const discoverySources: string[] = [];

  const cityIdsFor = async (platformId: string, listing: NonNullable<typeof platforms[number]["listing"]>, industry: string) => {
    if (!listing.cityIndex) return undefined;
    const key = `${platformId}:${industry}`;
    const cached = cityIdCache.get(key);
    if (cached) return cached;
    const { ids, error, source } = await discoverCityIds(listing, industry, fetcher);
    cityIdCache.set(key, ids);
    if (error) discoveryErrors.push(`${platformId}/${industry}: ${error}`);
    // Which candidate page actually worked, so the list of guesses in config
    // can be trimmed to the one right answer rather than to another guess.
    if (source) discoverySources.push(`${platformId}/${industry}: ${ids.size} towns from ${source}`);
    return ids;
  };

  let attempted = 0;
  let completed = 0;
  let failedCount = 0;
  let listingsWritten = 0;
  const failures: string[] = [];

  outer: for (const scope of scopes) {
    if (attempted >= batchSize) break;
    if (Date.now() - startedAt > WORK_DEADLINE_MS) break;

    for (const platform of platforms) {
      if (Date.now() - startedAt > WORK_DEADLINE_MS) break outer;

      const key = coverageKey({ platform: platform.id, ...scope });
      const existing = await repos.directoryIndex.getCrawl(key);
      // A completed, fresh index needs nothing. A failed one is retried,
      // because the reason was often temporary and a permanent failure costs
      // one request to re-establish.
      if (existing?.status === "complete" && existing.crawledAt > staleBefore) continue;

      attempted += 1;
      const listing = platform.listing!;
      const cityIds = await cityIdsFor(platform.id, listing, scope.industry);

      const { crawl, listings } = await crawlDirectory(platform, scope, {
        fetcher,
        listing,
        now: nowIso,
        newId: () => randomUUID(),
        cityIds,
        delayMs: PAGE_DELAY_MS,
      });

      if (listings.length > 0) listingsWritten += await repos.directoryIndex.putListings(listings);
      await repos.directoryIndex.recordCrawl(crawl);

      if (crawl.status === "complete") {
        completed += 1;
      } else {
        failedCount += 1;
        // One example per platform is enough to diagnose without flooding.
        if (failures.length < platforms.length * 2) {
          failures.push(`${platform.id} ${scope.city}/${scope.industry}: ${crawl.detail}`);
        }
      }
    }
  }

  const [indexedListings, completeCrawls, failedCrawls] = await Promise.all([
    repos.directoryIndex.countListings(),
    repos.directoryIndex.countCrawls("complete"),
    repos.directoryIndex.countCrawls("failed"),
  ]);

  try {
    await logActivity(repos.agentActivity, {
      agentId: "researcher",
      action: "directory_crawl",
      summary:
        `Read ${completed} town director${completed === 1 ? "y" : "ies"}` +
        (failedCount > 0 ? `, ${failedCount} could not be read` : "") +
        `. ${indexedListings.toLocaleString()} businesses indexed so far.`,
      // A run where every attempt failed is a broken run, not a quiet one.
      level: attempted > 0 && completed === 0 ? "error" : "info",
    });
  } catch {
    // The index is already written; failing to log must not lose it.
  }

  const summary = {
    attempted,
    completed,
    failed: failedCount,
    listingsWritten,
    indexedListings,
    completeCrawls,
    failedCrawls,
    discoveryErrors,
    discoverySources,
    failures,
    ms: Date.now() - startedAt,
  };
  console.log(`crawl-directories ${JSON.stringify(summary)}`);
  return NextResponse.json(summary);
}
