import { NextResponse, type NextRequest } from "next/server";
import {
  MockReasoningProvider,
  coverageKey,
  getBookingDirectories,
  getScoringConfig,
  logActivity,
  matchAgainstDirectories,
  resolveBatchSize,
  type DirectoryCrawl,
} from "@market-outreach/core";
import { getRepos } from "../../../../lib/data";
import { isDemoMode } from "../../../../lib/demo";

/**
 * Settles the booking question from the town directories already read.
 *
 * Touches no external site at all. Everything it needs was fetched once by the
 * crawl and stored, so this is a database join wearing a cron's clothes — and
 * that is the whole point of the redesign. The version this replaced asked the
 * platforms about one business at a time, against a per-business search URL
 * these platforms do not have, and returned 404 forty-three thousand times.
 *
 * The rule it exists to enforce: a lead may only be recorded as having no
 * online booking when EVERY enabled platform has a completed directory for its
 * town and trade. One missing index and the answer stays UNKNOWN and the lead
 * stays in the holding area. "We could not look" must never be recorded as
 * "we looked and they are not there".
 *
 * Auth: CRON_SECRET.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Large, because nothing here is fetched over the network.
 *
 * The old batch of 120 was sized for up to five HTTP requests per lead. This
 * one costs a handful of indexed queries per town, shared across every lead in
 * that town.
 */
const DEFAULT_BATCH = 1_000;
const WORK_DEADLINE_MS = 90_000;

/**
 * How long before an unresolved lead is reconsidered.
 *
 * Shorter than it was, because retrying now costs nothing and the reason a
 * lead is unresolved is usually that its town has not been crawled yet — which
 * changes on its own within days.
 */
const RETRY_AFTER_DAYS = 3;

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
  const batchSize = resolveBatchSize(request.nextUrl.searchParams.get("batch"), DEFAULT_BATCH, 5_000);
  const directories = getBookingDirectories();
  const now = new Date();
  const nowIso = now.toISOString();
  const retryBefore = new Date(now.getTime() - RETRY_AFTER_DAYS * 86_400_000).toISOString();

  const queueFilter = { awaitingDirectoryLookup: retryBefore } as const;
  const queue = await repos.leads.list({
    ...queueFilter,
    // Oldest-looked-up first, never-looked-up first of all. Leads stay in this
    // queue while their town has no index, so a score ordering would hand the
    // same rows back run after run while the rest never moved.
    orderBy: "least-recently-looked-up",
    limit: batchSize,
  });

  if (queue.length === 0) {
    return NextResponse.json({ checked: 0, remaining: 0, done: true });
  }

  const deps = {
    platforms: directories.platforms,
    index: repos.directoryIndex,
    match: directories.matching,
    scoringConfig: getScoringConfig(),
    reasoning: new MockReasoningProvider(),
    now: nowIso,
  };

  /**
   * Crawl records cached per town-and-trade for the length of the run.
   *
   * A batch of a thousand leads spans maybe thirty towns, and each lead would
   * otherwise re-read the same handful of rows — a thousand queries to answer
   * thirty questions.
   */
  const crawlCache = new Map<string, DirectoryCrawl[]>();
  const crawlsFor = async (lead: (typeof queue)[number]) => {
    const key = coverageKey({ platform: "*", city: lead.city, state: lead.state, industry: lead.industry });
    const cached = crawlCache.get(key);
    if (cached) return cached;
    const crawls = await repos.directoryIndex.crawlsFor({
      city: lead.city,
      state: lead.state,
      industry: lead.industry,
    });
    crawlCache.set(key, crawls);
    return crawls;
  };

  const startedAt = Date.now();
  let checked = 0;
  let resolvedCount = 0;
  let foundCount = 0;
  const waitingOn = new Map<string, number>();
  const pending: (typeof queue)[number][] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    await repos.leads.upsertMany(pending.splice(0, pending.length));
  };

  for (const lead of queue) {
    if (Date.now() - startedAt > WORK_DEADLINE_MS) break;

    const result = await matchAgainstDirectories(lead, { ...deps, crawls: await crawlsFor(lead) });
    checked += 1;
    pending.push(result.lead);
    if (result.resolved) resolvedCount += 1;
    if (result.lead.onlineBookingStatus === "THIRD_PARTY_BOOKING_SYSTEM") foundCount += 1;
    for (const missing of result.missingIndexes) {
      waitingOn.set(missing.platform, (waitingOn.get(missing.platform) ?? 0) + 1);
    }

    if (pending.length >= 200) await flush();
  }

  await flush();

  const remaining = await repos.leads.count(queueFilter);
  const waiting = [...waitingOn.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([platform, count]) => `${platform} ×${count}`);

  try {
    await logActivity(repos.agentActivity, {
      agentId: "researcher",
      action: "directory_match",
      summary:
        `Checked ${checked.toLocaleString()} business${checked === 1 ? "" : "es"} against the booking directories` +
        ` — ${resolvedCount.toLocaleString()} settled, ${foundCount.toLocaleString()} already book online.` +
        (waiting.length ? ` Waiting on directories for: ${waiting.join(", ")}.` : "") +
        ` ${remaining.toLocaleString()} still queued.`,
    });
  } catch {
    // Results are already written; failing to log must not lose them.
  }

  const summary = {
    checked,
    resolved: resolvedCount,
    alreadyBookOnline: foundCount,
    unresolved: checked - resolvedCount,
    waitingOnDirectories: waiting,
    remaining,
    ms: Date.now() - startedAt,
    done: false,
  };
  console.log(`lookup-directories ${JSON.stringify(summary)}`);
  return NextResponse.json(summary);
}
