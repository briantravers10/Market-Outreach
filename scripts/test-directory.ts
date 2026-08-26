/**
 * Booking-directory lookup test suite.
 *
 * Offline: canned pages, a fake search API, and an in-memory cost store, so no
 * request leaves the machine and no money is spent.
 *
 * The asymmetry drives everything under test. A business found on Booksy is a
 * WORSE prospect — they already have an incumbent — so a false positive quietly
 * discards a good lead and is invisible, while a false negative merely wastes a
 * call. The bar for claiming a match is therefore deliberately high, and
 * "could not check" must never collapse into "not listed".
 *
 *   npm run test-directory
 */
import {
  DirectDirectoryLookup,
  RecordingSpendGuard,
  SearchApiDirectoryLookup,
  StubSiteFetcher,
  buildSearchQuery,
  cityMatches,
  extractCandidatesFromHtml,
  lookupBookingDirectories,
  lookupWithFallback,
  nameSimilarity,
  normaliseName,
  pickMatch,
  searchUrlFor,
  MockReasoningProvider,
  getScoringConfig,
  type CostEntry,
  type CostRepository,
  type DirectoryPlatform,
  type Lead,
  type MatchOptions,
  type SearchApiResult,
} from "@market-outreach/core";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

const BOOKSY: DirectoryPlatform = {
  id: "booksy",
  label: "Booksy",
  domain: "booksy.com",
  searchUrlTemplate: "https://booksy.com/en-us/s/{query}",
  profilePathPattern: "/en-us/[0-9]+_",
  enabled: true,
};

const MATCH: MatchOptions = { minimumNameSimilarity: 0.82, requireCityMatch: true };

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    businessName: "Bella Hair Studio",
    city: "Tampa",
    state: "FL",
    zip: "33601",
    instagram: null,
    facebook: null,
    prospectScore: 40,
    onlineBookingStatus: "UNKNOWN",
    bookingMethod: "UNKNOWN",
    bookingProvider: null,
    locationEvidence: [],
    analysisVersion: null,
    scoreBreakdown: [],
    services: [],
    detectedLinks: [],
    stagesCompleted: [],
    ...overrides,
  } as unknown as Lead;
}

function memoryCosts(): CostRepository & { entries: CostEntry[] } {
  const entries: CostEntry[] = [];
  return {
    entries,
    async upsert(entry) {
      entries.push(entry);
      return entry;
    },
    async list() {
      return entries;
    },
    async getById(id) {
      return entries.find((e) => e.id === id) ?? null;
    },
    async remove(id) {
      const i = entries.findIndex((e) => e.id === id);
      if (i >= 0) entries.splice(i, 1);
    },
  };
}

function searchApi(results: SearchApiResult[], ok = true) {
  let calls = 0;
  const transport = async () => {
    calls += 1;
    return { ok, results, error: ok ? null : "rate limited" };
  };
  return { transport, calls: () => calls };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  section("Name normalisation");
  // ---------------------------------------------------------------------------

  check("case and punctuation are stripped", normaliseName("Bella's Hair Studio!") === normaliseName("bellas hair studio"));
  check(
    "trade words carry no identity",
    normaliseName("Bella Hair Salon") === normaliseName("Bella"),
    normaliseName("Bella Hair Salon")
  );
  check("legal suffixes are dropped", normaliseName("Bella LLC") === normaliseName("Bella"));

  // ---------------------------------------------------------------------------
  section("Similarity");
  // ---------------------------------------------------------------------------

  check("identical names score 1", nameSimilarity("Bella Studio", "Bella Studio") === 1);
  check("a possessive still matches", nameSimilarity("Bellas Studio", "Bella Studio") >= 0.9);
  check(
    "an extra descriptor does not hurt",
    nameSimilarity("Bella Studio", "Bella Studio — Downtown Tampa") >= 0.82,
    String(nameSimilarity("Bella Studio", "Bella Studio — Downtown Tampa"))
  );
  check(
    "different businesses one word apart do NOT match",
    nameSimilarity("Marco Hair Studio", "Sofia Hair Studio") < 0.82,
    String(nameSimilarity("Marco Hair Studio", "Sofia Hair Studio"))
  );
  check("unrelated names score low", nameSimilarity("Bella Studio", "Kwik Kuts") < 0.3);
  check("empty input scores zero", nameSimilarity("", "Bella") === 0);

  // ---------------------------------------------------------------------------
  section("City matching");
  // ---------------------------------------------------------------------------

  const lead = makeLead();
  check("the city name matches", cityMatches(lead, "Bella Studio, Tampa FL"));
  check("the ZIP matches", cityMatches(lead, "somewhere 33601"));
  check("a different city does not", !cityMatches(lead, "Bella Studio, Miami FL"));
  check("no location text is not a match", !cityMatches(lead, null));

  // ---------------------------------------------------------------------------
  section("Picking a match — refuses to guess");
  // ---------------------------------------------------------------------------

  {
    const match = pickMatch(lead, [{ url: "https://booksy.com/en-us/1_bella", name: "Bella Hair Studio", locationText: "Tampa, FL" }], MATCH);
    check("a clear single match is taken", match !== null);
  }
  {
    const match = pickMatch(lead, [{ url: "u", name: "Bella Hair Studio", locationText: "Miami, FL" }], MATCH);
    check("the right name in the wrong city is refused", match === null);
  }
  {
    const match = pickMatch(lead, [{ url: "u", name: "Kwik Kuts", locationText: "Tampa, FL" }], MATCH);
    check("the wrong name in the right city is refused", match === null);
  }
  {
    // Two near-identical listings: genuinely ambiguous, so no claim.
    const match = pickMatch(
      lead,
      [
        { url: "a", name: "Bella Hair Studio", locationText: "Tampa, FL" },
        { url: "b", name: "Bella Hair Studio", locationText: "Tampa, FL" },
      ],
      MATCH
    );
    check("a near-tie is refused rather than picking one", match === null);
  }
  check("no candidates gives no match", pickMatch(lead, [], MATCH) === null);

  // ---------------------------------------------------------------------------
  section("Queries and URLs");
  // ---------------------------------------------------------------------------

  check("the query carries name, city and state", buildSearchQuery(lead) === "Bella Hair Studio Tampa FL");
  check("the search URL is encoded", searchUrlFor(BOOKSY, "a b").includes("a%20b"));

  // ---------------------------------------------------------------------------
  section("Reading a results page");
  // ---------------------------------------------------------------------------

  const RESULTS_HTML = `
    <a href="https://booksy.com/en-us/12345_bella-hair-studio_tampa">Bella Hair Studio</a>
    <a href="https://booksy.com/en-us/67890_kwik-kuts_tampa">Kwik Kuts</a>
    <a href="https://booksy.com/en-us/about">About Booksy</a>
    <a href="https://facebook.com/booksy">Facebook</a>`;

  {
    const candidates = extractCandidatesFromHtml(RESULTS_HTML, "https://booksy.com/", BOOKSY);
    check("profile links are found", candidates.length === 2, String(candidates.length));
    check("a non-profile page is ignored", !candidates.some((c) => c.url.includes("/about")));
    check("an off-domain link is ignored", !candidates.some((c) => c.url.includes("facebook")));
    check("the city from the path becomes location text", candidates[0].locationText?.includes("tampa") === true);
  }
  {
    const broken = { ...BOOKSY, profilePathPattern: "([" };
    check("a bad pattern yields nothing rather than throwing", extractCandidatesFromHtml(RESULTS_HTML, "https://booksy.com/", broken).length === 0);
  }

  // ---------------------------------------------------------------------------
  section("Direct lookup — blocked is never 'not listed'");
  // ---------------------------------------------------------------------------

  const url = searchUrlFor(BOOKSY, buildSearchQuery(lead));

  {
    const lookup = new DirectDirectoryLookup(new StubSiteFetcher({ [url]: { html: RESULTS_HTML, status: 200, error: null } }), MATCH);
    const outcome = await lookup.search(lead, BOOKSY);
    check("a real listing is found", outcome.kind === "found", outcome.kind);
    check("with its profile URL", outcome.kind === "found" && outcome.profileUrl.includes("12345"));
  }

  {
    const html = `<a href="https://booksy.com/en-us/67890_kwik-kuts_tampa">Kwik Kuts</a>`;
    const lookup = new DirectDirectoryLookup(new StubSiteFetcher({ [url]: { html, status: 200, error: null } }), MATCH);
    const outcome = await lookup.search(lead, BOOKSY);
    check("a page of other businesses is 'not listed'", outcome.kind === "not_listed", outcome.kind);
  }

  for (const [status, label] of [[403, "blocked"], [429, "rate limited"], [404, "wrong URL"]] as const) {
    const lookup = new DirectDirectoryLookup(new StubSiteFetcher({ [url]: { html: "x", status, error: null } }), MATCH);
    const outcome = await lookup.search(lead, BOOKSY);
    check(`HTTP ${status} (${label}) is unavailable, not 'not listed'`, outcome.kind === "unavailable", outcome.kind);
  }

  {
    const lookup = new DirectDirectoryLookup(new StubSiteFetcher({}), MATCH);
    const outcome = await lookup.search(lead, BOOKSY);
    check("a failed fetch is unavailable", outcome.kind === "unavailable");
  }

  {
    // A page we could not parse is not evidence of absence.
    const lookup = new DirectDirectoryLookup(
      new StubSiteFetcher({ [url]: { html: "<div>script-rendered</div>", status: 200, error: null } }),
      MATCH
    );
    const outcome = await lookup.search(lead, BOOKSY);
    check("no profile links at all is unavailable, not 'not listed'", outcome.kind === "unavailable", outcome.kind);
    check(
      "and says the page shape probably changed",
      outcome.kind === "unavailable" && outcome.reason.includes("page shape"),
      outcome.kind === "unavailable" ? outcome.reason : ""
    );
  }

  // ---------------------------------------------------------------------------
  section("Paid search");
  // ---------------------------------------------------------------------------

  {
    const api = searchApi([
      { url: "https://booksy.com/en-us/12345_bella", title: "Bella Hair Studio | Booksy", description: "Tampa, FL" },
    ]);
    const lookup = new SearchApiDirectoryLookup(api.transport, MATCH, 1);
    const outcome = await lookup.search(lead, BOOKSY);
    check("a search result is matched", outcome.kind === "found", outcome.kind);
    check(
      "the platform's branding is stripped from the title",
      outcome.kind === "found" && outcome.matchedName === "Bella Hair Studio",
      outcome.kind === "found" ? outcome.matchedName : ""
    );
  }

  {
    const api = searchApi([]);
    const lookup = new SearchApiDirectoryLookup(api.transport, MATCH, 1);
    const outcome = await lookup.search(lead, BOOKSY);
    check("an empty result set IS evidence of absence", outcome.kind === "not_listed", outcome.kind);
  }

  {
    const api = searchApi([], false);
    const lookup = new SearchApiDirectoryLookup(api.transport, MATCH, 1);
    const outcome = await lookup.search(lead, BOOKSY);
    check("a failed search is unavailable", outcome.kind === "unavailable");
  }

  {
    const lookup = new SearchApiDirectoryLookup(null, MATCH, 1);
    check("no key means unavailable", !lookup.available());
    check("and searching says so", (await lookup.search(lead, BOOKSY)).kind === "unavailable");
  }

  {
    // Results from another domain are not this platform's listings.
    const api = searchApi([{ url: "https://yelp.com/biz/bella", title: "Bella Hair Studio", description: "Tampa" }]);
    const lookup = new SearchApiDirectoryLookup(api.transport, MATCH, 1);
    check("off-domain results are ignored", (await lookup.search(lead, BOOKSY)).kind === "not_listed");
  }

  // ---------------------------------------------------------------------------
  section("The spending cap");
  // ---------------------------------------------------------------------------

  {
    const costs = memoryCosts();
    let id = 0;
    const guard = new RecordingSpendGuard(costs, 100, "Brave Search", () => `c${++id}`, () => "2026-08-26T12:00:00.000Z", 2);

    check("spending is allowed under the cap", await guard.canSpend(1));
    await guard.record(1, { query: "q", platform: "booksy" });
    await guard.record(1, { query: "q", platform: "booksy" });
    check("a cost entry is written after the flush interval", costs.entries.length === 1, String(costs.entries.length));
    check("marked automatic", costs.entries[0]?.automatic === true);
    check("counting the searches", costs.entries[0]?.units === 2);
    check("in whole cents", Number.isInteger(costs.entries[0]?.amountMinor));
  }

  {
    const costs = memoryCosts();
    let id = 0;
    // Cap of 5 cents, already spent.
    await costs.upsert({
      id: "existing", kind: "usage", vendor: "Brave Search", description: "earlier run",
      amountMinor: 5, currency: "USD", interval: null, startedAt: "2026-08-01T00:00:00.000Z",
      endedAt: null, units: 10, unitLabel: "searches", automatic: true, createdAt: "2026-08-01T00:00:00.000Z",
    });
    const guard = new RecordingSpendGuard(costs, 5, "Brave Search", () => `c${++id}`, () => "2026-08-26T12:00:00.000Z");
    check("the cap counts spending from previous runs", !(await guard.canSpend(1)));
  }

  {
    const costs = memoryCosts();
    await costs.upsert({
      id: "sub", kind: "subscription", vendor: "Pipedrive", description: "CRM",
      amountMinor: 3900, currency: "USD", interval: "monthly", startedAt: "2026-06-01T00:00:00.000Z",
      endedAt: null, units: null, unitLabel: null, automatic: false, createdAt: "2026-06-01T00:00:00.000Z",
    });
    const guard = new RecordingSpendGuard(costs, 100, "Brave Search", () => "c1", () => "2026-08-26T12:00:00.000Z");
    check(
      "another vendor's subscription does not eat the search budget",
      await guard.canSpend(1),
      "a Pipedrive bill is not a reason to stop looking leads up"
    );
  }

  {
    const costs = memoryCosts();
    const guard = new RecordingSpendGuard(costs, 0, "Brave Search", () => "c1", () => "2026-08-26T12:00:00.000Z");
    check("a zero cap blocks everything", !(await guard.canSpend(1)));
  }

  {
    // A capped lookup must refuse without spending, and say why.
    const costs = memoryCosts();
    const guard = new RecordingSpendGuard(costs, 0, "Brave Search", () => "c1", () => "2026-08-26T12:00:00.000Z");
    const api = searchApi([]);
    const lookup = new SearchApiDirectoryLookup(api.transport, MATCH, 1, guard);
    const outcome = await lookup.search(lead, BOOKSY);
    check("a capped search is unavailable", outcome.kind === "unavailable");
    check("no request was made", api.calls() === 0);
    check(
      "and the cap is named",
      outcome.kind === "unavailable" && outcome.reason.includes("cap"),
      outcome.kind === "unavailable" ? outcome.reason : ""
    );
  }

  // ---------------------------------------------------------------------------
  section("Free first, paid only when free cannot answer");
  // ---------------------------------------------------------------------------

  {
    const api = searchApi([]);
    const free = new DirectDirectoryLookup(new StubSiteFetcher({ [url]: { html: RESULTS_HTML, status: 200, error: null } }), MATCH);
    const paid = new SearchApiDirectoryLookup(api.transport, MATCH, 1);
    const { outcome, via } = await lookupWithFallback(lead, BOOKSY, [free, paid]);
    check("a free answer is used", outcome.kind === "found");
    check("and nothing was paid for", api.calls() === 0);
    check("reported as coming from the free lookup", via === "direct");
  }

  {
    // Free lookup blocked -> pay.
    const api = searchApi([
      { url: "https://booksy.com/en-us/12345_bella", title: "Bella Hair Studio | Booksy", description: "Tampa, FL" },
    ]);
    const free = new DirectDirectoryLookup(new StubSiteFetcher({ [url]: { html: "x", status: 403, error: null } }), MATCH);
    const paid = new SearchApiDirectoryLookup(api.transport, MATCH, 1);
    const { outcome, via } = await lookupWithFallback(lead, BOOKSY, [free, paid]);
    check("a blocked free lookup falls through to paid", outcome.kind === "found", outcome.kind);
    check("which cost one search", api.calls() === 1);
    check("reported as coming from the paid lookup", via === "search-api");
  }

  {
    // "Not listed" is a real answer and must not be paid to re-confirm.
    const api = searchApi([]);
    const html = `<a href="https://booksy.com/en-us/67890_kwik-kuts_tampa">Kwik Kuts</a>`;
    const free = new DirectDirectoryLookup(new StubSiteFetcher({ [url]: { html, status: 200, error: null } }), MATCH);
    const paid = new SearchApiDirectoryLookup(api.transport, MATCH, 1);
    const { outcome } = await lookupWithFallback(lead, BOOKSY, [free, paid]);
    check("a free 'not listed' stops the chain", outcome.kind === "not_listed");
    check("and costs nothing", api.calls() === 0);
  }

  // ---------------------------------------------------------------------------
  section("Applying the result to a lead");
  // ---------------------------------------------------------------------------

  const workerDeps = {
    scoringConfig: getScoringConfig(),
    reasoning: new MockReasoningProvider(),
    now: "2026-08-26T12:00:00.000Z",
  };

  {
    const free = new DirectDirectoryLookup(new StubSiteFetcher({ [url]: { html: RESULTS_HTML, status: 200, error: null } }), MATCH);
    const result = await lookupBookingDirectories(makeLead(), { platforms: [BOOKSY], lookups: [free], ...workerDeps });
    check("a found business gets a booking status", result.lead.onlineBookingStatus === "THIRD_PARTY_BOOKING_SYSTEM");
    check("and the platform is named", result.lead.bookingProvider === "Booksy");
    check("the question is resolved", result.resolved);
    check("the evidence links to the profile", result.lead.locationEvidence.some((e) => e.includes("booksy.com")));
    check("the summary says they are not a prospect", result.summary.includes("not a prospect"));
  }

  {
    const html = `<a href="https://booksy.com/en-us/67890_kwik-kuts_tampa">Kwik Kuts</a>`;
    const free = new DirectDirectoryLookup(new StubSiteFetcher({ [url]: { html, status: 200, error: null } }), MATCH);
    const result = await lookupBookingDirectories(makeLead(), { platforms: [BOOKSY], lookups: [free], ...workerDeps });
    check("every platform answering 'no' means NONE", result.lead.onlineBookingStatus === "NONE");
    check("which resolves the lead", result.resolved);
    check("and stamps the current method", result.lead.analysisVersion !== null);
    check("the summary says they ARE a prospect", result.summary.includes("real prospect"));
  }

  {
    // THE important one: one platform blocked means the answer stays open.
    const blocked = new DirectDirectoryLookup(new StubSiteFetcher({ [url]: { html: "x", status: 403, error: null } }), MATCH);
    const result = await lookupBookingDirectories(makeLead(), { platforms: [BOOKSY], lookups: [blocked], ...workerDeps });
    check(
      "a blocked platform leaves booking UNKNOWN, never NONE",
      result.lead.onlineBookingStatus === "UNKNOWN",
      result.lead.onlineBookingStatus
    );
    check("the lead is not resolved", !result.resolved);
    check("it is not stamped with the current method", result.lead.analysisVersion === null);
    check("and the unreachable platform is reported", result.unavailable.length === 1);
  }

  {
    // Two platforms, one answers "no" and one is blocked: still UNKNOWN.
    const OTHER: DirectoryPlatform = { ...BOOKSY, id: "vagaro", label: "Vagaro", domain: "vagaro.com", searchUrlTemplate: "https://vagaro.com/s/{query}", profilePathPattern: ".*" };
    const html = `<a href="https://booksy.com/en-us/67890_kwik-kuts_tampa">Kwik Kuts</a>`;
    const fetcher = new StubSiteFetcher({
      [url]: { html, status: 200, error: null },
      [searchUrlFor(OTHER, buildSearchQuery(lead))]: { html: "x", status: 403, error: null },
    });
    const result = await lookupBookingDirectories(makeLead(), {
      platforms: [BOOKSY, OTHER],
      lookups: [new DirectDirectoryLookup(fetcher, MATCH)],
      ...workerDeps,
    });
    check(
      "one clean 'no' plus one blocked is still UNKNOWN",
      result.lead.onlineBookingStatus === "UNKNOWN",
      "they might be on the platform we could not check"
    );
    check("and unresolved", !result.resolved);
  }

  {
    // A disabled platform is skipped entirely.
    const disabled = { ...BOOKSY, enabled: false };
    const result = await lookupBookingDirectories(makeLead(), {
      platforms: [disabled],
      lookups: [new DirectDirectoryLookup(new StubSiteFetcher({}), MATCH)],
      ...workerDeps,
    });
    check("a disabled platform is not checked", result.unavailable.length === 0);
    check("and nothing is concluded", !result.resolved);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\nFailures:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
