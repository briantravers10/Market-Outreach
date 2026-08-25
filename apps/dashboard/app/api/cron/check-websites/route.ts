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
export const maxDuration = 60;

/**
 * How many leads to pull off the queue. Not how many get done — the deadline
 * below decides that. Pulling generously means a fast run is not artificially
 * capped, and pulling more than can be finished costs one query.
 */
const DEFAULT_BATCH = 400;

/** Leaves the invocation room to write results and answer before its 60s limit. */
const WORK_DEADLINE_MS = 42_000;

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

  const repos = getRepos();
  // Timed in three parts. The first run of this checked two sites in a window
  // sized for hundreds, and without knowing which part ate the budget any fix
  // would have been a guess.
  const startedAt = Date.now();
  const queue = await repos.leads.list({
    awaitingWebsiteCheck: true,
    orderBy: "score",
    limit: batchSize,
  });
  const queueMs = Date.now() - startedAt;

  if (queue.length === 0) {
    const remaining = await repos.leads.count({ awaitingWebsiteCheck: true });
    return NextResponse.json({ checked: 0, remaining, done: true });
  }

  const workStartedAt = Date.now();
  const results = await checkWebsites(queue, {
    fetcher: new HttpSiteFetcher(6_000),
    scoringConfig: getScoringConfig(),
    reasoning: new MockReasoningProvider(),
    now: new Date().toISOString(),
    concurrency: 12,
    deadlineMs: WORK_DEADLINE_MS,
  });

  const workMs = Date.now() - workStartedAt;

  // Only the leads actually processed are written. The rest of the slice was
  // never touched, so it stays queued rather than being stamped as checked.
  const writeStartedAt = Date.now();
  await repos.leads.upsertMany(results.map((result) => result.lead));
  const writeMs = Date.now() - writeStartedAt;

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
    ...timing,
    checked: results.length,
    reachable,
    unreachable: results.length - reachable,
    scoreImproved: improved,
    nowQualified,
    remaining: await repos.leads.count({ awaitingWebsiteCheck: true }),
    done: false,
  });
}
