import { NextResponse, type NextRequest } from "next/server";
import { leadsToCsv, csvFilename, findLeadPreset, type LeadFilter } from "@market-outreach/core";
import { getRepos, getIndustries } from "../../../../lib/data";

/**
 * Spreadsheet export of the Leads view.
 *
 * Reads the same query string the Leads page uses, so whatever is on screen is
 * exactly what downloads — filter first, then export, with no second filtering
 * language to learn.
 *
 * Auth: this route is NOT public. Everything outside PUBLIC_PATHS requires a
 * session (see middleware.ts); the only exception carved out there is
 * /api/cron/*, which authenticates itself. So this needs no check of its own,
 * and adding one would be the kind of second, drifting copy of the auth rule
 * that eventually disagrees with the first.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const num = (key: string) => {
    const raw = params.get(key);
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  const text = (key: string) => params.get(key) || undefined;

  const filter: LeadFilter = {
    state: params.get("state")?.toUpperCase() || undefined,
    zip: text("zip"),
    city: text("city"),
    industry: text("industry"),
    minScore: num("minScore"),
    websiteStatus: text("websiteStatus") as LeadFilter["websiteStatus"],
    onlineBookingStatus: text("onlineBookingStatus") as LeadFilter["onlineBookingStatus"],
    bookingProvider: text("bookingProvider"),
    minStaffCount: num("minStaffCount"),
    dataConfidence: text("dataConfidence") as LeadFilter["dataConfidence"],
    researchStatus: text("researchStatus") as LeadFilter["researchStatus"],
    qualificationStatus: text("qualificationStatus") as LeadFilter["qualificationStatus"],
    orderBy: "score",
    // The page is paged; the file is not — downloading the first 200 of 77,000
    // would be a quietly wrong export. The ceiling exists only so a single
    // request cannot try to serialise an entire national database.
    limit: 100_000,
  };

  const repos = getRepos();
  let leads = await repos.leads.list(filter);

  // The name search is applied in memory on the page too — the repository
  // filter has no free-text field — so it is repeated here rather than
  // silently dropped, which would make the file wider than the screen.
  const q = params.get("q");
  if (q) {
    const needle = q.toLowerCase();
    leads = leads.filter((lead) => lead.businessName.toLowerCase().includes(needle));
  }

  // The High-Priority page's saved views are code, not query filters, so they
  // are applied here from the same shared definition the page renders from.
  const preset = findLeadPreset(params.get("preset") ?? undefined);
  if (preset) leads = leads.filter(preset.test);

  const labels = new Map(getIndustries().map((industry) => [industry.id, industry.label]));
  const csv = leadsToCsv(leads, { industryLabel: (id) => labels.get(id) ?? id });
  const prefix = params.get("view") === "high-priority" ? "high-priority-leads" : "leads";
  const filename = csvFilename(preset ? `${prefix}-${preset.key}` : prefix, new Date());

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // A stale export is worse than a slow one.
      "cache-control": "no-store",
    },
  });
}
