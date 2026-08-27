import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import {
  DirectDirectoryLookup,
  HttpSiteFetcher,
  MockReasoningProvider,
  RecordingSpendGuard,
  SEARCH_SPEND_CAP_KEY,
  SearchApiDirectoryLookup,
  createBraveTransport,
  getBookingDirectories,
  getScoringConfig,
  logActivity,
  lookupBookingDirectories,
  resolveBatchSize,
  type DirectoryLookup,
} from "@market-outreach/core";
import { getRepos } from "../../../../lib/data";
import { isDemoMode } from "../../../../lib/demo";

/**
 * Settles the booking question for leads their own website could not answer.
 *
 * This is the second half of the research pipeline and the reason leads sit in
 * the holding area: the Website Analyst can only report what a site says, and
 * a business with no site — or a one-page site with a phone number on it —
 * leaves the single most important question open. Searching the booking
 * platforms is the only way to close it, and until it closes the lead is not
 * safe to put in front of anyone.
 *
 * It runs on cron for the same reason the website check does. It was built,
 * tested, and then not scheduled, which meant it never ran once — the same
 * shape of gap as a queue nothing drained.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Small batches, deliberately.
 *
 * A single lead here can mean up to five HTTP requests to five different
 * platforms, each of which may be slow or may be a paid search costing money.
 * That is an order of magnitude more work per lead than reading one website,
 * so the batch is an order of magnitude smaller.
 */
const DEFAULT_BATCH = 120;
const WORK_DEADLINE_MS = 200_000;

/**
 * How long before a lead is searched again.
 *
 * A business that could not be found and could not be ruled out stays UNKNOWN
 * forever unless something changes, and something changing takes weeks, not
 * minutes. Without this the queue would re-search the same unresolvable leads
 * on every run — ahead of the ones nobody has searched at all, because they
 * sort by score, not by age.
 */
const RETRY_AFTER_DAYS = 30;

/** Brave's cheapest tier, in minor units. Half a cent per search. */
const COST_PER_SEARCH_MINOR = 0.5;

/**
 * Collapses a failure message to a short category so counts are readable.
 *
 * Deliberately keeps anything it does not recognise, truncated rather than
 * bucketed as "other" — an unrecognised failure is exactly the one worth
 * seeing in full, and a catch-all bucket is how a new failure mode hides.
 */
function categoriseReason(reason: string): string {
  if (/timed out/i.test(reason)) return "timeout";
  const status = reason.match(/HTTP (\d{3})/);
  if (status) return `http-${status[1]}`;
  if (/refused the request/i.test(reason)) return "blocked";
  if (/no profile links/i.test(reason)) return "no-profile-links";
  if (/empty response/i.test(reason)) return "empty-response";
  if (/not html/i.test(reason)) return "not-html";
  if (/no search api key/i.test(reason)) return "no-paid-search-key";
  if (/spending cap/i.test(reason)) return "cap-reached";
  return reason.slice(0, 60);
}

function summariseReasons(byPlatform: Map<string, Map<string, number>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [platform, reasons] of byPlatform) {
    out[platform] = [...reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `${reason} ×${count}`)
      .join(", ");
  }
  return out;
}

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

  const repos = getRepos();
  const batchSize = resolveBatchSize(request.nextUrl.searchParams.get("batch"), DEFAULT_BATCH, 500);
  const directories = getBookingDirectories();
  const now = new Date();
  const nowIso = now.toISOString();
  const retryBefore = new Date(now.getTime() - RETRY_AFTER_DAYS * 86_400_000).toISOString();

  const queueFilter = { awaitingDirectoryLookup: retryBefore } as const;
  // Oldest-looked-up first, never-looked-up first of all. Leads stay in this
  // queue when a search cannot settle them, so score ordering would hand the
  // same rows back run after run while the rest never moved.
  const queue = await repos.leads.list({
    ...queueFilter,
    orderBy: "least-recently-looked-up",
    limit: batchSize,
  });

  if (queue.length === 0) {
    return NextResponse.json({ checked: 0, remaining: 0, done: true });
  }

  /**
   * Free first, paid second — the owner's instruction, and the right order
   * anyway. The direct lookup costs nothing and may well answer; paying to
   * ask a search engine is only worth it when the platform itself refuses us.
   *
   * With no API key the paid lookup reports itself unavailable rather than
   * pretending, so the chain still runs and leads simply stay UNKNOWN. That is
   * the correct outcome for "we could not check", and it is why forgetting the
   * key cannot quietly mark businesses as having no online booking.
   */
  const braveKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  const capRaw = await repos.settings.get(SEARCH_SPEND_CAP_KEY);
  const capMinor = Number.parseInt(capRaw ?? "0", 10) || 0;
  const guard = new RecordingSpendGuard(
    repos.costs,
    capMinor,
    "Brave Search",
    () => randomUUID(),
    () => new Date().toISOString()
  );

  const lookups: DirectoryLookup[] = [
    new DirectDirectoryLookup(new HttpSiteFetcher(5_000), directories.matching),
    new SearchApiDirectoryLookup(
      braveKey ? createBraveTransport(braveKey) : null,
      directories.matching,
      COST_PER_SEARCH_MINOR,
      guard
    ),
  ];

  const deps = {
    platforms: directories.platforms,
    lookups,
    scoringConfig: getScoringConfig(),
    reasoning: new MockReasoningProvider(),
    now: nowIso,
  };

  const startedAt = Date.now();
  let resolvedCount = 0;
  let foundCount = 0;
  let checked = 0;
  /** Which platforms refused us, and how often. Named in the reply so a broken URL template shows up as a pattern rather than as silence. */
  const blocked = new Map<string, number>();
  /**
   * How often each platform failed each way: platform -> reason -> count.
   *
   * Counted rather than sampled. The first version of this kept one example
   * reason per platform and reported "Booksy: timed out" — which turned out to
   * be one request in a hundred and twenty, with no way to tell whether the
   * rest timed out too or failed instantly for some other reason. A single
   * example from a concurrent batch is not evidence about the batch.
   *
   * The distinction is what decides the next move: a 403 across the board
   * means they block us and the paid fallback is the answer, a 404 means the
   * search URL is simply wrong and costs nothing to fix, and "no profile
   * links" means the page is drawn by script and neither would help.
   */
  const blockedWhy = new Map<string, Map<string, number>>();
  const pending: Awaited<ReturnType<typeof lookupBookingDirectories>>["lead"][] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    await repos.leads.upsertMany(pending.splice(0, pending.length));
  };

  /**
   * Several leads at once, but each lead's platforms in order.
   *
   * The per-lead loop has to stay sequential: finding a business on the first
   * platform is a complete answer, and firing all five in parallel would pay
   * for four searches whose results are thrown away.
   *
   * Across leads, though, sequential does not finish. One lead can mean five
   * requests to five slow hosts, so a batch of 120 done one at a time would
   * spend the whole deadline on perhaps forty of them. Six at a time is enough
   * to fill the invocation without turning us into something the platforms
   * would rightly rate-limit.
   */
  const CONCURRENCY = 6;
  let cursor = 0;

  const runOne = async (lead: (typeof queue)[number]) => {
    const result = await lookupBookingDirectories(lead, deps);
    checked += 1;
    // Written whether or not the question was settled: an unresolved lead
    // still gets its directory_checked_at stamp, and losing that stamp is
    // what would turn the cooldown into an infinite loop.
    pending.push(result.lead);
    if (result.resolved) resolvedCount += 1;
    if (result.lead.onlineBookingStatus === "THIRD_PARTY_BOOKING_SYSTEM") foundCount += 1;
    for (const item of result.unavailable) {
      blocked.set(item.platform, (blocked.get(item.platform) ?? 0) + 1);
      const byReason = blockedWhy.get(item.platform) ?? new Map<string, number>();
      const reason = categoriseReason(item.reason);
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
      blockedWhy.set(item.platform, byReason);
    }
    if (pending.length >= 25) await flush();
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        if (Date.now() - startedAt > WORK_DEADLINE_MS) return;
        const index = cursor;
        cursor += 1;
        if (index >= queue.length) return;
        try {
          await runOne(queue[index]);
        } catch {
          // One lead's lookup blowing up must not take the batch with it. The
          // lead keeps no stamp, so it stays queued and comes round again.
        }
      }
    })
  );

  await flush();
  // Whatever this run spent gets written even if it stopped short of a full
  // batch. Spend that only lands on a clean finish is spend the page under-reports.
  await guard.flush();

  const remaining = await repos.leads.count(queueFilter);
  const blockedSummary = [...blocked.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([platform, count]) => `${platform} ×${count}`);

  try {
    await logActivity(repos.agentActivity, {
      agentId: "researcher",
      action: "directory_lookup",
      summary:
        `Searched booking platforms for ${checked} business${checked === 1 ? "" : "es"}` +
        ` — ${resolvedCount} settled (${foundCount} already book online).` +
        (blockedSummary.length ? ` Could not reach: ${blockedSummary.join(", ")}.` : "") +
        ` ${remaining.toLocaleString()} still queued.`,
      // A run where nothing could be reached is a broken run, not a quiet one,
      // and it should look different on the Team page.
      level: checked > 0 && resolvedCount === 0 ? "error" : "info",
    });
  } catch {
    // The results are already written; failing to log must not lose them.
  }

  console.log(
    `lookup-directories ${JSON.stringify({
      checked,
      resolved: resolvedCount,
      found: foundCount,
      remaining,
      paidSearch: Boolean(braveKey),
      capMinor,
      blocked: blockedSummary,
      why: summariseReasons(blockedWhy),
      ms: Date.now() - startedAt,
    })}`
  );

  return NextResponse.json({
    checked,
    resolved: resolvedCount,
    alreadyBookOnline: foundCount,
    unresolved: checked - resolvedCount,
    blocked: blockedSummary,
    blockedWhy: summariseReasons(blockedWhy),
    paidSearchConfigured: Boolean(braveKey),
    spendCapMinor: capMinor,
    remaining,
    done: false,
  });
}
