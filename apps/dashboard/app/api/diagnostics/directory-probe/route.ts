import { NextResponse, type NextRequest } from "next/server";
import {
  HttpSiteFetcher,
  buildSearchQuery,
  extractCandidatesFromHtml,
  getBookingDirectories,
  searchUrlFor,
  type Lead,
} from "@market-outreach/core";
import { isDemoMode } from "../../../../lib/demo";

/**
 * Asks each booking platform's search page what it actually does, and says so.
 *
 * This exists because the search URLs in config/booking-directories.json were
 * written without being able to reach those sites, and three of the five were
 * simply wrong — every request a 404, reported as "unavailable", so nothing
 * was mis-scored but nothing could ever be found either. Guessing replacement
 * URLs blind is what produced that, and doing it again would be the same
 * mistake with different characters in it.
 *
 * So: propose a template, run it against the real network from the deployment
 * that has to use it, and read what comes back. The answer distinguishes the
 * three cases that need three different fixes — a wrong path (404), a block
 * (403/429), and a page whose results are drawn by script (200 with no
 * profile links in the HTML).
 *
 * Auth: CRON_SECRET, the same key the scheduled jobs use.
 *
 * A caller may override a platform's template to try a candidate, but the URL
 * it produces must still resolve to that platform's own configured domain.
 * This endpoint fetches a URL on request, and without that check it would be a
 * way to make the deployment fetch anything at all.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Enough of a lead to build a realistic query. Not a real business — nothing is written. */
const SAMPLE = {
  businessName: "Bella Hair Studio",
  city: "Miami",
  state: "FL",
} as Pick<Lead, "businessName" | "city" | "state"> as Lead;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isDemoMode) {
    return NextResponse.json({ error: "Not available on the demo deployment." }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const only = params.get("platform");
  const templateOverride = params.get("template");
  const businessName = params.get("name") ?? SAMPLE.businessName;
  const city = params.get("city") ?? SAMPLE.city;

  const lead = { ...SAMPLE, businessName, city } as Lead;
  const query = buildSearchQuery(lead);
  const directories = getBookingDirectories();
  const platforms = directories.platforms.filter((p) => (only ? p.id === only : p.enabled));

  if (platforms.length === 0) {
    return NextResponse.json(
      { error: `No platform matched "${only}".`, known: directories.platforms.map((p) => p.id) },
      { status: 400 }
    );
  }
  if (templateOverride && platforms.length !== 1) {
    return NextResponse.json(
      { error: "A template override applies to one platform — name it with ?platform=<id>." },
      { status: 400 }
    );
  }

  const fetcher = new HttpSiteFetcher(12_000);

  const results = await Promise.all(
    platforms.map(async (platform) => {
      const candidate = templateOverride ? { ...platform, searchUrlTemplate: templateOverride } : platform;
      const url = searchUrlFor(candidate, query);

      // The override is caller-supplied, so the URL it produced is checked
      // against the platform's own domain before anything is fetched.
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        return { platform: platform.id, url, error: "Not a valid URL." };
      }
      if (host !== platform.domain && !host.endsWith(`.${platform.domain}`)) {
        return {
          platform: platform.id,
          url,
          error: `Refused: ${host} is not ${platform.domain}. A template may only point at its own platform.`,
        };
      }

      const page = await fetcher.fetchPage(url);
      if (page.error) {
        return { platform: platform.id, url, status: page.status, error: page.error };
      }

      const candidates = extractCandidatesFromHtml(page.html, page.finalUrl, candidate);
      const totalLinks = (page.html.match(/<a\s/gi) ?? []).length;
      const title = page.html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1]?.trim() ?? null;

      return {
        platform: platform.id,
        url,
        status: page.status,
        finalUrl: page.finalUrl === url ? null : page.finalUrl,
        title,
        htmlBytes: page.html.length,
        anchorsOnPage: totalLinks,
        profileMatches: candidates.length,
        // Three or four is enough to tell a real profile link from a nav link.
        sampleMatches: candidates.slice(0, 4).map((c) => ({ name: c.name, url: c.url })),
        /**
         * The reading, in one line, because a bare status code invites the
         * wrong conclusion. Plenty of anchors but no profile matches means the
         * page loaded and the PATTERN is wrong; almost no anchors at all means
         * the page is an empty shell that script fills in later, and no URL or
         * pattern will fix that one.
         */
        verdict:
          page.status >= 400
            ? `HTTP ${page.status} — this URL is wrong or refused.`
            : candidates.length > 0
              ? `Works: ${candidates.length} profile link(s) found.`
              : totalLinks > 20
                ? `Page loads with ${totalLinks} links but none match profilePathPattern — the pattern is probably wrong.`
                : `Page loads but is nearly empty (${totalLinks} links) — results are drawn by script, so scraping cannot see them.`,
      };
    })
  );

  return NextResponse.json({ query, results });
}
