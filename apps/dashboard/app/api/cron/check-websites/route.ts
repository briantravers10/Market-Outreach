import { NextResponse, type NextRequest } from "next/server";
import {
  checkWebsites,
  resolveBatchSize,
  HttpSiteFetcher,
  MockReasoningProvider,
  getScoringConfig,
} from "@market-outreach/core";
import { getRepos } from "../../../../lib/data";
import { isDemoMode } from "../../../../lib/demo";

/**
 * Works through the queue of prospect websites nobody has read yet.
 *
 * Driven by cron rather than a button because there are tens of thousands of
 * sites to fetch and no single request finishes that. Each firing takes a slice
 * of the queue, best prospects first, and the queue drains over hours. Nothing
 * is lost if a run dies mid-way: every lead is stamped as it completes, so the
 * next run picks up exactly where this one stopped.
 *
 * Auth: CRON_SECRET, same as the scheduled-reports endpoint. It refuses to run
 * without one rather than defaulting open.
 */
export const dynamic = "force-dynamic";
/**
 * Raised from 60 on evidence: production logs show this route hitting the 60s
 * ceiling, and the work is now heavier per lead — a re-check may fetch four
 * URL forms for an unreachable site, or a homepage plus four inner pages.
 * A longer invocation is also far cheaper than the same work split across
 * six times as many cold starts and queue queries.
 */
export const maxDuration = 300;

/**
 * How many leads to pull off the queue. Not how many get done — the deadline
 * below decides that. Pulling generously means a fast run is not artificially
 * capped, and pulling more than can be finished costs one query.
 *
 * Raised from 400 on evidence rather than optimism: the first healthy run did
 * 400 sites in 19.8s of a 42s budget, averaging 49ms each. 800 should land
 * around 40s, and if a batch turns out to be full of slow hosts the deadline
 * stops it early and leaves the remainder queued — which is the whole reason
 * the budget is a deadline and not a count.
 */
const DEFAULT_BATCH = 800;

/**
 * Leaves the invocation room to write results and answer before the limit.
 *
 * Results are also flushed to the database as they complete rather than in one
 * write at the end. The end-write alone was catastrophic: a 240s budget inside
 * a 300s function meant the cron fetched eight hundred sites every ten minutes
 * and was killed before saving any of them. Hours of activity in the logs,
 * nothing changed in the database. With incremental flushing a killed run keeps
 * everything it finished, so the deadline is an optimisation rather than the
 * only thing standing between a run and total loss.
 */
const WORK_DEADLINE_MS = 200_000;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set, so this endpoint refuses to run." },
      { status: 503 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isDemoMode) {
    return NextResponse.json({ error: "The demo database is a read-only snapshot." }, { status: 403 });
  }

  const batchSize = resolveBatchSize(request.nextUrl.searchParams.get("batch"), DEFAULT_BATCH, 1000);

  /**
   * Which queue to drain.
   *
   *   (default)      leads nobody has read yet
   *   ?mode=recheck  leads read by an older, worse version of the analysis
   *
   * The re-check queue exists because the first queue keys on "never checked",
   * which every lead now fails. Without a second queue, improving the analyser
   * could never reach the leads the old one already decided.
   */
  const recheck = request.nextUrl.searchParams.get("mode") === "recheck";
  // Everything checked before this moment was read by the older analysis.
  // Passed explicitly so a run cannot re-select the leads it just wrote, which
  // would loop forever on the same slice.
  const recheckBefore = request.nextUrl.searchParams.get("before") ?? new Date().toISOString();
  const queueFilter = recheck
    ? { needsWebsiteRecheck: recheckBefore }
    : { awaitingWebsiteCheck: true };

  const repos = getRepos();
  // Timed in three parts. The first run of this checked two sites in a window
  // sized for hundreds, and without knowing which part ate the budget any fix
  // would have been a guess.
  const startedAt = Date.now();
  const queue = await repos.leads.list({
    ...queueFilter,
    orderBy: "score",
    limit: batchSize,
  });
  const queueMs = Date.now() - startedAt;

  if (queue.length === 0) {
    const remaining = await repos.leads.count(queueFilter);
    return NextResponse.json({ mode: recheck ? "recheck" : "new", checked: 0, remaining, done: true });
  }

  const workStartedAt = Date.now();
  let writeMs = 0;
  const results = await checkWebsites(queue, {
    // Shorter per-request timeout on a re-check: most of that queue is sites
    // that already failed once, and four URL forms at six seconds each would
    // let a handful of dead domains consume the entire budget.
    fetcher: new HttpSiteFetcher(recheck ? 4_000 : 6_000),
    scoringConfig: getScoringConfig(),
    reasoning: new MockReasoningProvider(),
    now: new Date().toISOString(),
    concurrency: 12,
    deadlineMs: WORK_DEADLINE_MS,
    // Save as we go. Only leads actually processed are written; the rest of the
    // slice was never touched and stays queued rather than being stamped.
    flushEvery: 50,
    onFlush: async (batch) => {
      const at = Date.now();
      await repos.leads.upsertMany(batch.map((result) => result.lead));
      writeMs += Date.now() - at;
    },
  });

  const workMs = Date.now() - workStartedAt;

  const reachable = results.filter((r) => r.reachable).length;
  const improved = results.filter(
    (r) => r.scoreAfter !== null && r.scoreBefore !== null && r.scoreAfter > r.scoreBefore
  ).length;
  const nowQualified = results.filter(
    (r) => r.lead.qualificationStatus === "QUALIFIED" || r.lead.qualificationStatus === "HIGH_PRIORITY"
  ).length;

  const timing = { queueMs, workMs, writeMs, queued: queue.length, perSiteMs: results.length ? Math.round(workMs / results.length) : null };
  // One structured line per run, so the next tick explains itself in the logs
  // without anyone having to reproduce it.
  console.log(`check-websites ${JSON.stringify({ ...timing, checked: results.length })}`);

  return NextResponse.json({
    mode: recheck ? "recheck" : "new",
    ...timing,
    checked: results.length,
    reachable,
    unreachable: results.length - reachable,
    scoreImproved: improved,
    nowQualified,
    remaining: await repos.leads.count(queueFilter),
    done: false,
  });
}
