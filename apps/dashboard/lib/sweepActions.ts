"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  checkWebsites,
  HttpSiteFetcher,
  MockReasoningProvider,
  getScoringConfig,
  type LeadFilter,
} from "@market-outreach/core";
import { getRepos } from "./data";
import { isDemoMode } from "./demo";

/**
 * Running the website sweep from the dashboard.
 *
 * The sweep has only ever been reachable by cron, which needs a bearer token
 * in a header — not something the owner can send from a tablet. That was fine
 * while the queue drained on its own, and stopped being fine the moment the
 * analysis improved: the re-check queue exists precisely because someone
 * decided to re-read leads, and deciding is a thing a person does.
 *
 * Same core function as the cron route, so there is one implementation of the
 * sweep and this cannot drift from what the schedule does.
 */

/** A server action runs inside a request, so its budget is far smaller than the cron's. */
const UI_DEADLINE_MS = 20_000;
const UI_BATCH = 120;

export interface SweepOutcome {
  mode: "new" | "recheck";
  checked: number;
  reachable: number;
  unreachable: number;
  bookingFound: number;
  scoreImproved: number;
  remaining: number;
}

export async function runSweepAction(form: FormData): Promise<void> {
  if (isDemoMode) return;

  const recheck = form.get("mode") === "recheck";
  const repos = getRepos();

  // Bound the re-check to now, so a run cannot re-select the leads it just
  // wrote and spin on the same slice forever.
  const before = new Date().toISOString();
  const queueFilter: LeadFilter = recheck
    ? { needsWebsiteRecheck: before }
    : { awaitingWebsiteCheck: true };

  const queue = await repos.leads.list({ ...queueFilter, orderBy: "score", limit: UI_BATCH });

  let outcome: SweepOutcome = {
    mode: recheck ? "recheck" : "new",
    checked: 0,
    reachable: 0,
    unreachable: 0,
    bookingFound: 0,
    scoreImproved: 0,
    remaining: await repos.leads.count(queueFilter),
  };

  if (queue.length > 0) {
    const results = await checkWebsites(queue, {
      fetcher: new HttpSiteFetcher(recheck ? 4_000 : 6_000),
      scoringConfig: getScoringConfig(),
      reasoning: new MockReasoningProvider(),
      now: new Date().toISOString(),
      concurrency: 12,
      deadlineMs: UI_DEADLINE_MS,
      // Saved as they complete, so a click that runs out of time still keeps
      // what it finished. Only leads actually processed are written; the rest
      // were never touched and stay queued rather than being stamped as done.
      flushEvery: 25,
      onFlush: async (batch) => {
        await repos.leads.upsertMany(batch.map((r) => r.lead));
      },
    });

    outcome = {
      mode: recheck ? "recheck" : "new",
      checked: results.length,
      reachable: results.filter((r) => r.reachable).length,
      unreachable: results.filter((r) => !r.reachable).length,
      bookingFound: results.filter(
        (r) => r.lead.onlineBookingStatus !== "NONE" && r.lead.onlineBookingStatus !== "UNKNOWN"
      ).length,
      scoreImproved: results.filter(
        (r) => r.scoreAfter !== null && r.scoreBefore !== null && r.scoreAfter !== r.scoreBefore
      ).length,
      remaining: await repos.leads.count(queueFilter),
    };
  }

  revalidatePath("/team/website-analyst");
  revalidatePath("/leads");
  revalidatePath("/overview");
  revalidatePath("/analytics");

  redirect(`/team/website-analyst?sweep=${encodeURIComponent(JSON.stringify(outcome))}`);
}

export async function decodeSweepOutcome(raw: string | undefined): Promise<SweepOutcome | null> {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SweepOutcome>;
    return {
      mode: parsed.mode === "recheck" ? "recheck" : "new",
      checked: Number(parsed.checked) || 0,
      reachable: Number(parsed.reachable) || 0,
      unreachable: Number(parsed.unreachable) || 0,
      bookingFound: Number(parsed.bookingFound) || 0,
      scoreImproved: Number(parsed.scoreImproved) || 0,
      remaining: Number(parsed.remaining) || 0,
    };
  } catch {
    // A hand-edited URL should show no banner, not crash the page.
    return null;
  }
}
