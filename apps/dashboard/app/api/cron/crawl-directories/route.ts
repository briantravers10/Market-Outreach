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

/**
 * Town-and-trade crawls per run.
 *
 * Raised from 6 on measurement rather than hope: a run of 7 took 78 seconds of
 * a 210-second budget, so roughly 11 seconds each. There are about 3,800
 * town-and-trade pairs and five platforms, and six per fifteen minutes would
 * have taken the better part of two weeks.
 */
const DEFAULT_BATCH = 60;
const WORK_DEADLINE_MS = 230_000;
/** Between page fetches on the same platform. Politeness, and it keeps us under their rate limits. */
const PAGE_DELAY_MS = 1_200;

/**
 * Towns crawled at once.
 *
 * The delay between pages is per-crawl, so running several concurrently
 * shortens the wall clock without making any single platform's requests come
 * faster than the delay allows — except that concurrent crawls may hit the
 * same platform. Four is chosen to be obviously survivable rather than
 * optimal: Booksy has already rate-limited us once, and the whole index is
 * worth having next week and worth nothing at all if we get blocked today.
 */
const CONCURRENCY = 4;

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

  const batchSize = resolveBatchSize(request.nextUrl.searchParams.get("batch"), DEFAULT_BATCH, 300);
  const now = new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - INDEX_FRESH_DAYS * 86_400_000).toISOString();
  const fetcher = new HttpSiteFetcher(12_000);
  const startedAt = Date.now();

  // Pull generously and filter to what still needs reading. Asking the
  // database for "scopes without a fresh crawl" would need a join against a
  // table it does not know about; asking for the busiest few hundred and
  // skipping the done ones costs one query and stays simple.
  const scopes = await repos.leads.directoryScopes(Math.max(200, batchSize * 4));

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
  const workingTemplates = new Map<string, string>();

  /**
   * Platforms that have refused us during this run.
   *
   * A 429 means slow down, and the useful response is to stop asking THIS
   * platform for the rest of the run rather than to keep going and collect
   * more of them. Other platforms are unaffected — one site rate-limiting us
   * is no reason to stop reading a different one.
   */
  const refusing = new Set<string>();

  // The unit of work is a platform-and-town pair, flattened so the pool can
  // pick up the next one without waiting for a whole town to finish.
  const units: { platform: (typeof platforms)[number]; scope: (typeof scopes)[number] }[] = [];
  for (const scope of scopes) {
    for (const platform of platforms) units.push({ platform, scope });
  }

  let cursor = 0;
  const claim = () => (attempted >= batchSize ? null : units[cursor++] ?? null);

  const runOne = async (unit: { platform: (typeof platforms)[number]; scope: (typeof scopes)[number] }) => {
    const { platform, scope } = unit;
    if (refusing.has(platform.id)) return;

    const key = coverageKey({ platform: platform.id, ...scope });
    const existing = await repos.directoryIndex.getCrawl(key);
    // A completed, fresh index needs nothing. A failed one is retried, because
    // the reason was often temporary and re-establishing a permanent failure
    // costs one request.
    if (existing?.status === "complete" && existing.crawledAt > staleBefore) return;

    attempted += 1;
    const listing = platform.listing!;
    const cityIds = await cityIdsFor(platform.id, listing, scope.industry);

    const { crawl, listings, usedTemplate } = await crawlDirectory(platform, scope, {
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
      if (usedTemplate) workingTemplates.set(platform.id, usedTemplate);
    } else {
      failedCount += 1;
      if (/HTTP 429|HTTP 403|refused the request/.test(crawl.detail ?? "")) refusing.add(platform.id);
      // A couple of examples per platform is enough to diagnose without
      // flooding the log with the same message six hundred times.
      if (failures.length < platforms.length * 2) {
        failures.push(`${platform.id} ${scope.city}/${scope.industry}: ${crawl.detail}`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, units.length) }, async () => {
      for (;;) {
        if (Date.now() - startedAt > WORK_DEADLINE_MS) return;
        const unit = claim();
        if (!unit) return;
        try {
          await runOne(unit);
        } catch {
          // One town blowing up must not take the batch with it. No crawl row
          // is written, so it is simply picked up again next time.
        }
      }
    })
  );

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
    // Which URL shape each platform is actually being served by, so the
    // candidate lists in config can be trimmed to the proven answer.
    workingTemplates: Object.fromEntries(workingTemplates),
    refusedUs: [...refusing],
    failures,
    ms: Date.now() - startedAt,
  };
  console.log(`crawl-directories ${JSON.stringify(summary)}`);
  return NextResponse.json(summary);
}
