import { NextResponse, type NextRequest } from "next/server";
import { generateReport, nextRunAt, rollingWeek, yesterday } from "@market-outreach/core";
import { createRepositories } from "@market-outreach/db";

/**
 * Runs any scheduled reports that are due.
 *
 * Called by Vercel Cron (see apps/dashboard/vercel.json). Designed to be run
 * frequently and do nothing most of the time: it fires only tasks whose
 * next_run_at has passed, then advances that timestamp, so a missed run catches
 * up on the next tick rather than being lost, and a double-invocation can't
 * generate the same report twice.
 *
 * AUTH: requires CRON_SECRET. Vercel Cron sends it as a Bearer token. Without
 * the variable set the route refuses outright rather than defaulting to open —
 * this endpoint writes to the database, so an unauthenticated version of it
 * would be a way for anyone to fill the archive.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured on this deployment." },
      { status: 503 }
    );
  }

  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("secret") ??
    "";
  if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const repos = createRepositories();
  const now = new Date();
  const due = await repos.scheduledTasks.list({ active: true, dueBefore: now.toISOString() });

  const results: { task: string; status: string; reportId?: string; error?: string }[] = [];

  for (const task of due) {
    try {
      const period = task.kind === "weekly_report" ? rollingWeek(now, 0) : yesterday(now);
      const report = await generateReport(repos, {
        type: task.kind === "weekly_report" ? "weekly" : "daily",
        period,
        generatedBy: "schedule",
        scheduledTaskId: task.id,
        now,
      });
      await repos.scheduledTasks.update({
        ...task,
        lastRunAt: now.toISOString(),
        lastRunStatus: "succeeded",
        nextRunAt: nextRunAt({ hour: task.hour, minute: task.minute, dayOfWeek: task.dayOfWeek }, now),
        updatedAt: now.toISOString(),
      });
      results.push({ task: task.name, status: "succeeded", reportId: report.id });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // A failed task still gets its next_run_at advanced, so one bad run
      // doesn't wedge the schedule into retrying forever on every tick.
      await repos.scheduledTasks.update({
        ...task,
        lastRunAt: now.toISOString(),
        lastRunStatus: `failed: ${detail}`.slice(0, 200),
        nextRunAt: nextRunAt({ hour: task.hour, minute: task.minute, dayOfWeek: task.dayOfWeek }, now),
        updatedAt: now.toISOString(),
      });
      results.push({ task: task.name, status: "failed", error: detail });
    }
  }

  return NextResponse.json({ ok: true, ran: results.length, results });
}
