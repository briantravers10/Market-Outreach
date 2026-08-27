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

/**
 * How long a FAILED crawl is left alone before being tried again.
 *
 * Without this, failures crowd out real work. A run picks the busiest towns
 * first, always in the same order, so the same failures come round every five
 * minutes and consume the batch before a single new town is reached. That is
 * not hypothetical: switching on three platforms whose URL shapes turned out
 * to be wrong took completed crawls from seven per run to zero, because sixty
 * slots per run went to re-proving the same failures.
 *
 * Long enough that a permanently broken platform costs almost nothing, short
 * enough that a site which was briefly down recovers within the hour.
 */
const FAILED_RETRY_HOURS = 6;

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
  const retryFailedBefore = new Date(now.getTime() - FAILED_RETRY_HOURS * 3_600_000).toISOString();
  const fetcher = new HttpSiteFetcher(12_000);
  const startedAt = Date.now();

  // Pull generously and filter to what still needs reading. Asking the
  // database for "scopes without a fresh crawl" would need a join against a
  // table it does not know about; asking for the busiest few hundred and
  // skipping the done ones costs one query and stays simple.
  const scopes = await repos.leads.directoryScopes(Math.max(400, batchSize * 8));

  /**
   * Town ids, pooled per platform and remembered between runs.
   *
   * Booksy addresses towns by an opaque number — /s/hair-salon/15889_miami —
   * read off its own index pages. Two things about that number matter here.
   *
   * It belongs to the TOWN, not the trade: 15889 is Miami whether the page is
   * hair salons or tattoo studios. So ids are pooled across every industry
   * rather than kept per industry, and each trade's index page contributes the
   * twenty-odd towns it happens to list to a set that serves all of them.
   *
   * And it accumulates. Each index page lists only the largest towns, which is
   * why Pensacola, Tallahassee and Jacksonville kept failing — no single page
   * names them. Persisting the pool means every run starts from everything
   * learned so far instead of rediscovering the same twenty towns and stalling
   * on the same gaps.
   */
  const CITY_ID_KEY = "booking_directory_city_ids";
  const cityIdPool = new Map<string, Map<string, string>>();
  const discoveryErrors: string[] = [];
  const discoverySources: string[] = [];
  const askedIndex = new Set<string>();
  let poolGrewBy = 0;

  try {
    const stored = await repos.settings.get(CITY_ID_KEY);
    if (stored) {
      for (const [platformId, ids] of Object.entries(JSON.parse(stored) as Record<string, Record<string, string>>)) {
        cityIdPool.set(platformId, new Map(Object.entries(ids)));
      }
    }
  } catch {
    // A malformed or missing pool just means starting over, which is slower
    // rather than wrong. It must never stop the crawl.
  }

  const cityIdsFor = async (
    platformId: string,
    listing: NonNullable<(typeof platforms)[number]["listing"]>,
    industry: string
  ) => {
    if (!listing.cityIndex) return undefined;
    const pool = cityIdPool.get(platformId) ?? new Map<string, string>();
    cityIdPool.set(platformId, pool);

    // One index fetch per trade per run: a trade already asked contributes
    // nothing more, and the pool already holds what it gave.
    const askedKey = `${platformId}:${industry}`;
    if (askedIndex.has(askedKey)) return pool;
    askedIndex.add(askedKey);

    const { ids, error, source } = await discoverCityIds(listing, industry, fetcher);
    let added = 0;
    for (const [slug, id] of ids) {
      if (!pool.has(slug)) {
        pool.set(slug, id);
        added += 1;
      }
    }
    poolGrewBy += added;

    if (error) discoveryErrors.push(`${platformId}/${industry}: ${error}`);
    // Which candidate page worked, and what it added that was new — so the
    // config can be trimmed to the proven answer, and a page that only ever
    // repeats what we have is visible as such.
    if (source) discoverySources.push(`${platformId}/${industry}: +${added} new of ${ids.size} from ${source}`);
    return pool;
  };

  let attempted = 0;
  let completed = 0;
  let failedCount = 0;
  let listingsWritten = 0;
  const failures: string[] = [];
  const workingTemplates = new Map<string, string>();
  let skippedRecentFailures = 0;

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
    // A completed, fresh index needs nothing.
    if (existing?.status === "complete" && existing.crawledAt > staleBefore) return;
    // A recent failure is left alone rather than re-proved on every run. The
    // reason for a failure is often temporary, so it IS retried — just not
    // twelve times an hour, ahead of towns nobody has looked at yet.
    if (existing?.status === "failed" && existing.crawledAt > retryFailedBefore) {
      skippedRecentFailures += 1;
      return;
    }

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

  // Everything learned about town ids, kept for the next run. Written after
  // the work rather than during it, so a run that dies mid-way costs at most
  // this run's discoveries rather than corrupting the pool.
  if (poolGrewBy > 0) {
    try {
      const serialised: Record<string, Record<string, string>> = {};
      for (const [platformId, ids] of cityIdPool) serialised[platformId] = Object.fromEntries(ids);
      await repos.settings.set(CITY_ID_KEY, JSON.stringify(serialised));
    } catch {
      // Losing the pool costs a rediscovery next run, nothing more.
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
    // Which URL shape each platform is actually being served by, so the
    // candidate lists in config can be trimmed to the proven answer.
    workingTemplates: Object.fromEntries(workingTemplates),
    refusedUs: [...refusing],
    skippedRecentFailures,
    townIdsKnown: Object.fromEntries([...cityIdPool].map(([id, ids]) => [id, ids.size])),
    townIdsLearnedThisRun: poolGrewBy,
    failures,
    ms: Date.now() - startedAt,
  };
  console.log(`crawl-directories ${JSON.stringify(summary)}`);
  return NextResponse.json(summary);
}
