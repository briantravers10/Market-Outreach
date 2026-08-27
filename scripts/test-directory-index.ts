/**
 * The town-directory index, and the one rule everything in it exists to serve.
 *
 * A lead may be recorded as having NO online booking only when every enabled
 * platform has a COMPLETED directory for its town and trade. Anything else —
 * a town nobody read, a crawl that died on page three, a platform that refused
 * us — leaves the answer UNKNOWN.
 *
 * That asymmetry is not fussiness. "They book by phone" is the single most
 * valuable fact this system can establish and the largest positive factor in
 * the score. Handing it out for a search that never happened produces a
 * confident-looking list of businesses that already have an incumbent, and the
 * owner finds out by ringing them.
 *
 *   npm run test-directory-index
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSqliteClient, SqlDirectoryIndexRepository } from "@market-outreach/db";
import {
  ANALYSIS_VERSION,
  coverageKey,
  crawlDirectory,
  discoverCityIds,
  extractCityIds,
  getScoringConfig,
  industrySlugFor,
  listingUrlFor,
  lookupInIndex,
  matchAgainstDirectories,
  MockReasoningProvider,
  slugify,
  type DirectoryCrawl,
  type DirectoryListing,
  type DirectoryPlatform,
  type FetchedPage,
  type Lead,
  type ListingConfig,
  type MatchOptions,
  type SiteFetcher,
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

const MATCH: MatchOptions = { minimumNameSimilarity: 0.82, requireCityMatch: true };

let idCounter = 0;
const nextId = () => `id-${(idCounter += 1)}`;

const BOOKSY: DirectoryPlatform = {
  id: "booksy",
  label: "Booksy",
  domain: "booksy.com",
  searchUrlTemplate: "https://booksy.com/en-us/s/{query}",
  profilePathPattern: "/en-us/[0-9]+_",
  enabled: true,
  requiredForNone: true,
};

const VAGARO: DirectoryPlatform = {
  id: "vagaro",
  label: "Vagaro",
  domain: "vagaro.com",
  searchUrlTemplate: "https://www.vagaro.com/search?q={query}",
  profilePathPattern: "^/[a-z0-9-]+$",
  enabled: true,
  requiredForNone: true,
};

const BOOKSY_LISTING: ListingConfig = {
  urlTemplates: ["https://booksy.com/en-us/s/{industry}/{cityId}_{city}"],
  pageParam: "page",
  firstPage: 1,
  maxPages: 3,
  cityIndex: {
    urlTemplates: ["https://booksy.com/en-us/s/{industry}", "https://booksy.com/sitemap.xml"],
    cityLinkPatterns: [
      "/en-us/s/[a-z0-9-]+/(\\d+)_([a-z0-9-]+)",
      "/en-us/\\d+_[a-z0-9-]+_[a-z0-9-]+_(\\d+)_([a-z0-9-]+)",
    ],
  },
};

const VAGARO_LISTING: ListingConfig = {
  urlTemplates: [
    "https://www.vagaro.com/listings/{industry}/{city}--{state}",
    "https://www.vagaro.com/listings/{city}--{state}/{industry}",
  ],
  pageParam: "page",
  firstPage: 1,
  maxPages: 3,
};

class StubFetcher implements SiteFetcher {
  readonly requested: string[] = [];
  constructor(private readonly pages: Record<string, Partial<FetchedPage>>) {}
  async fetchPage(url: string): Promise<FetchedPage> {
    this.requested.push(url);
    const page = this.pages[url];
    if (!page) return { finalUrl: url, status: 404, html: "", error: null };
    return { finalUrl: url, status: 200, html: "", error: null, ...page };
  }
}

let seq = 0;
function lead(overrides: Partial<Lead> = {}): Lead {
  seq += 1;
  return {
    id: `lead-${seq}`,
    businessName: "Bella Hair Studio",
    industry: "hair-salons",
    address: "1 Main St",
    city: "Miami",
    state: "FL",
    zip: "33101",
    phone: null,
    email: null,
    website: null,
    websiteStatus: "NONE",
    websiteQuality: "UNKNOWN",
    onlineBookingStatus: "UNKNOWN",
    bookingProvider: null,
    bookingMethod: "UNKNOWN",
    staffCount: null,
    staffCountConfidence: "LOW",
    rating: null,
    reviewCount: null,
    instagram: null,
    facebook: null,
    socialActivity: "UNKNOWN",
    locationCount: null,
    services: [],
    prospectScore: 25,
    scoreBreakdown: [],
    scoreReason: null,
    dataConfidence: "LOW",
    discoverySource: "test",
    externalId: null,
    sourceConfidence: null,
    latitude: null,
    longitude: null,
    websiteCheckedAt: null,
    analysisVersion: null,
    directoryCheckedAt: null,
    verifiedBy: null,
    verifiedAt: null,
    dateDiscovered: "2026-08-01T00:00:00.000Z",
    dateLastResearched: null,
    researchStatus: "PENDING",
    qualificationStatus: "UNQUALIFIED",
    pipelineStage: "DISCOVERED",
    campaignId: "camp-1",
    jobId: "job-1",
    isDuplicateOf: null,
    stagesCompleted: [],
    linkInBioUrl: null,
    detectedLinks: [],
    serviceArea: null,
    locationConfidence: "UNKNOWN",
    locationEvidence: [],
    notes: "",
    ...overrides,
  } as Lead;
}

function crawl(overrides: Partial<DirectoryCrawl> = {}): DirectoryCrawl {
  const base = { platform: "booksy", city: "Miami", state: "FL", industry: "hair-salons" };
  return {
    id: coverageKey(base),
    ...base,
    status: "complete",
    listingsFound: 3,
    pagesRead: 1,
    detail: null,
    crawledAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function listing(name: string, url: string, platform = "booksy"): DirectoryListing {
  return {
    id: `${platform}-${name}`,
    platform,
    city: "Miami",
    state: "FL",
    industry: "hair-salons",
    businessName: name,
    profileUrl: url,
    crawledAt: "2026-08-20T00:00:00.000Z",
  };
}

function makeRepo(): SqlDirectoryIndexRepository {
  const db = new Database(":memory:");
  db.exec(readFileSync(join(process.cwd(), "packages", "db", "src", "schema.sql"), "utf8"));
  return new SqlDirectoryIndexRepository(createSqliteClient(db));
}

async function main(): Promise<void> {
  section("Building the URL for a town");

  check("a town slug loses its punctuation", slugify("St. Petersburg") === "st-petersburg", slugify("St. Petersburg"));
  check("accents are stripped, not encoded", slugify("Cañada") === "canada", slugify("Cañada"));
  check("apostrophes vanish rather than splitting the word", slugify("O'Brien") === "obrien", slugify("O'Brien"));
  check(
    "a trade defaults to the singular, which is what both platforms use",
    industrySlugFor(VAGARO_LISTING, "hair-salons") === "hair-salon"
  );
  check(
    "an explicit mapping wins over the guess",
    industrySlugFor({ ...VAGARO_LISTING, industrySlugs: { "day-spas": "spa" } }, "day-spas") === "spa"
  );

  check(
    "Vagaro's town URL is built from the town alone",
    listingUrlFor(VAGARO_LISTING, { city: "Coral Gables", state: "FL", industry: "hair-salons" }) ===
      "https://www.vagaro.com/listings/hair-salon/coral-gables--fl",
    String(listingUrlFor(VAGARO_LISTING, { city: "Coral Gables", state: "FL", industry: "hair-salons" }))
  );
  check(
    "Booksy's town URL needs the town id",
    listingUrlFor(BOOKSY_LISTING, { city: "Miami", state: "FL", industry: "hair-salons", cityId: "15889" }) ===
      "https://booksy.com/en-us/s/hair-salon/15889_miami"
  );
  check(
    "without a town id it refuses to build one at all",
    listingUrlFor(BOOKSY_LISTING, { city: "Miami", state: "FL", industry: "hair-salons" }) === null,
    "a URL containing the literal text {cityId} would 404 and read exactly like an empty town"
  );
  check(
    "page two carries the page parameter",
    listingUrlFor(VAGARO_LISTING, { city: "Miami", state: "FL", industry: "hair-salons" }, 2)?.includes("page=2") === true
  );
  check(
    "page one does not",
    listingUrlFor(VAGARO_LISTING, { city: "Miami", state: "FL", industry: "hair-salons" }, 1)?.includes("page=") === false
  );

  section("Discovering town ids");

  {
    const html = `
      <a href="/en-us/s/hair-salon/15889_miami">Miami</a>
      <a href="/en-us/s/hair-salon/15890_miami-beach">Miami Beach</a>
      <a href="/en-us/s/hair-salon/15889_miami">Miami again</a>`;
    const ids = extractCityIds(html, BOOKSY_LISTING.cityIndex!.cityLinkPatterns);
    check("ids are read off the town index", ids.get("miami") === "15889" && ids.get("miami-beach") === "15890");
    check("a repeated town keeps the first id", ids.size === 2, String(ids.size));
  }

  check("a broken pattern yields nothing rather than throwing", extractCityIds("<a href='/x'>", "([").size === 0);

  {
    // A town id also appears in every business profile URL, and a page with no
    // town links at all is often covered in profile links. That second pattern
    // is what turns "this page is useless" into "this page names sixty towns".
    const ids = extractCityIds(
      `<a href="/en-us/940574_luxe-beauty-by-mily_hair-salon_15889_miami">Luxe Beauty</a>`,
      BOOKSY_LISTING.cityIndex!.cityLinkPatterns
    );
    check("a town id is also read out of a business profile link", ids.get("miami") === "15889", JSON.stringify([...ids]));
  }

  check(
    "one broken pattern does not stop the others being tried",
    extractCityIds(`<a href="/en-us/s/hair-salon/15889_miami">x</a>`, ["([", "/en-us/s/[a-z0-9-]+/(\\d+)_([a-z0-9-]+)"]).get(
      "miami"
    ) === "15889"
  );

  {
    const fetcher = new StubFetcher({ "https://booksy.com/en-us/s/hair-salon": { html: "<a href='/nothing'>x</a>" } });
    const { ids, error, source } = await discoverCityIds(BOOKSY_LISTING, "hair-salons", fetcher);
    check("no candidate page yielding ids reports every attempt", ids.size === 0 && error !== null, String(error));
    check("and names no source", source === null);
    check("having genuinely tried each candidate", fetcher.requested.length === 2, fetcher.requested.join(", "));
  }

  {
    // The real shape of the problem: the first candidate is a dead end and a
    // later one works. Falling through is the whole point of the list.
    const fetcher = new StubFetcher({
      "https://booksy.com/en-us/s/hair-salon": { html: "<a href='/nothing'>x</a>" },
      "https://booksy.com/sitemap.xml": { html: "<loc>https://booksy.com/en-us/s/hair-salon/15889_miami</loc>" },
    });
    const { ids, source } = await discoverCityIds(BOOKSY_LISTING, "hair-salons", fetcher);
    check("a later candidate page is used when the first has nothing", ids.get("miami") === "15889");
    check("and the one that worked is named, so the guessing can stop", source?.endsWith("sitemap.xml") === true, String(source));
  }

  section("Crawling a town");

  const VAGARO_MIAMI = "https://www.vagaro.com/listings/hair-salon/miami--fl";
  const page2 = `${VAGARO_MIAMI}?page=2`;
  const page3 = `${VAGARO_MIAMI}?page=3`;

  {
    const fetcher = new StubFetcher({
      [VAGARO_MIAMI]: { html: `<a href="/bellahair">Bella Hair Studio</a><a href="/cutsbyjo">Cuts by Jo</a>` },
      [page2]: { html: `<a href="/thirdplace">Third Place</a>` },
      [page3]: { html: `<a href="/thirdplace">Third Place</a>` },
    });
    const { crawl: result, listings } = await crawlDirectory(
      VAGARO,
      { city: "Miami", state: "FL", industry: "hair-salons" },
      { fetcher, listing: VAGARO_LISTING, now: "2026-08-27T00:00:00.000Z", newId: nextId }
    );
    check("a town that reads cleanly is complete", result.status === "complete", String(result.detail));
    check("every page's listings are kept", listings.length === 3, String(listings.length));
    check(
      "paging stops when a page repeats what we already have",
      result.pagesRead === 3,
      `${result.pagesRead} pages`
    );
    check("the coverage key is deterministic", result.id === "vagaro:fl:miami:hair-salons", result.id);
  }

  {
    // THE test. A crawl that dies partway must be recorded as failed and its
    // partial listings discarded — a half-index is indistinguishable from a
    // whole one at lookup time, and a business on the missing half would be
    // reported as not being on the platform.
    const fetcher = new StubFetcher({
      [VAGARO_MIAMI]: { html: `<a href="/bellahair">Bella Hair Studio</a>` },
      [page2]: { status: 500, html: "", error: null },
    });
    const { crawl: result, listings } = await crawlDirectory(
      VAGARO,
      { city: "Miami", state: "FL", industry: "hair-salons" },
      { fetcher, listing: VAGARO_LISTING, now: "2026-08-27T00:00:00.000Z", newId: () => "x" }
    );
    check("a crawl that breaks partway is FAILED, not partial", result.status === "failed", result.status);
    check("and it keeps none of what it read", listings.length === 0, String(listings.length));
    check("and it says what went wrong", (result.detail ?? "").includes("500"), String(result.detail));
  }

  {
    // The other side of the same coin: running out of pages is how a directory
    // ends, and must NOT be reported as a fault.
    const fetcher = new StubFetcher({
      [VAGARO_MIAMI]: { html: `<a href="/bellahair">Bella Hair Studio</a>` },
      [page2]: { status: 404, html: "" },
    });
    const { crawl: result, listings } = await crawlDirectory(
      VAGARO,
      { city: "Miami", state: "FL", industry: "hair-salons" },
      { fetcher, listing: VAGARO_LISTING, now: "2026-08-27T00:00:00.000Z", newId: nextId }
    );
    check("a 404 past the last page is a clean finish, not a failure", result.status === "complete", String(result.detail));
    check("and page one's listings are kept", listings.length === 1, String(listings.length));
  }

  {
    const fetcher = new StubFetcher({ [VAGARO_MIAMI]: { status: 429, html: "" } });
    const { crawl: result } = await crawlDirectory(
      VAGARO,
      { city: "Miami", state: "FL", industry: "hair-salons" },
      { fetcher, listing: VAGARO_LISTING, now: "2026-08-27T00:00:00.000Z", newId: () => "x" }
    );
    check("being rate-limited is a failure, never an empty town", result.status === "failed");
    check("and it names the refusal", (result.detail ?? "").includes("429"), String(result.detail));
  }

  {
    const fetcher = new StubFetcher({ [VAGARO_MIAMI]: { html: "<html><body><div id=app></div></body></html>" } });
    const { crawl: result } = await crawlDirectory(
      VAGARO,
      { city: "Miami", state: "FL", industry: "hair-salons" },
      { fetcher, listing: VAGARO_LISTING, now: "2026-08-27T00:00:00.000Z", newId: () => "x" }
    );
    check(
      "a page with no profile links at all is a failure, not a town with no salons",
      result.status === "failed",
      String(result.detail)
    );
  }

  {
    const fetcher = new StubFetcher({});
    const { crawl: result } = await crawlDirectory(
      BOOKSY,
      { city: "Miami", state: "FL", industry: "hair-salons" },
      { fetcher, listing: BOOKSY_LISTING, now: "2026-08-27T00:00:00.000Z", newId: () => "x" }
    );
    check("no town id means no crawl, and it says so", result.status === "failed");
    check("and nothing was even requested", fetcher.requested.length === 0, fetcher.requested.join(", "));
  }

  {
    // Falling through candidate shapes. The first shape 404s, the second
    // works — which is precisely the situation three of the five configured
    // platforms are in, and the reason the config holds candidates at all.
    const alt = "https://www.vagaro.com/listings/miami--fl/hair-salon";
    const fetcher = new StubFetcher({
      [alt]: { html: `<a href="/bellahair">Bella Hair Studio</a>` },
      [`${alt}?page=2`]: { status: 404, html: "" },
    });
    const { crawl: result, listings, usedTemplate } = await crawlDirectory(
      VAGARO,
      { city: "Miami", state: "FL", industry: "hair-salons" },
      { fetcher, listing: VAGARO_LISTING, now: "2026-08-27T00:00:00.000Z", newId: nextId }
    );
    check("a second URL shape is tried when the first 404s", result.status === "complete", String(result.detail));
    check("and its listings are kept", listings.length === 1, String(listings.length));
    check(
      "and the shape that worked is reported, so the guessing can end",
      usedTemplate?.includes("{city}--{state}/{industry}") === true,
      String(usedTemplate)
    );
  }

  {
    // Being refused stops the search rather than trying the other shapes.
    // More requests to somewhere already turning us away is not diagnosis.
    const fetcher = new StubFetcher({ [VAGARO_MIAMI]: { status: 429, html: "" } });
    const { crawl: result } = await crawlDirectory(
      VAGARO,
      { city: "Miami", state: "FL", industry: "hair-salons" },
      { fetcher, listing: VAGARO_LISTING, now: "2026-08-27T00:00:00.000Z", newId: nextId }
    );
    check("a 429 stops the shape search instead of hammering them", fetcher.requested.length === 1, fetcher.requested.join(", "));
    check("and the crawl fails rather than looking empty", result.status === "failed");
  }

  {
    const fetcher = new StubFetcher({});
    const { crawl: result } = await crawlDirectory(
      VAGARO,
      { city: "Nowhere", state: "FL", industry: "hair-salons" },
      { fetcher, listing: VAGARO_LISTING, now: "2026-08-27T00:00:00.000Z", newId: nextId }
    );
    check("every shape failing is a failure that lists what was tried", result.status === "failed");
    check("naming each URL", (result.detail ?? "").split("|").length >= 2, String(result.detail));
  }

  section("Looking a business up in an index");

  {
    const verdict = lookupInIndex(
      lead(),
      BOOKSY,
      crawl(),
      [listing("Bella Hair Studio", "https://booksy.com/en-us/123_bella-hair-studio_hair-salon_15889_miami")],
      MATCH
    );
    check("a business in the index is found", verdict.kind === "listed", verdict.kind);
  }

  {
    const verdict = lookupInIndex(lead(), BOOKSY, crawl(), [listing("Cuts by Jo", "https://booksy.com/en-us/9_jo")], MATCH);
    check("a business absent from a COMPLETE index is genuinely not listed", verdict.kind === "not-listed", verdict.kind);
  }

  {
    const verdict = lookupInIndex(lead(), BOOKSY, null, [], MATCH);
    check("a town nobody has read gives no answer", verdict.kind === "no-index", verdict.kind);
  }

  {
    const verdict = lookupInIndex(lead(), BOOKSY, crawl({ status: "failed", detail: "HTTP 429" }), [], MATCH);
    check(
      "a town whose crawl FAILED gives no answer either",
      verdict.kind === "no-index",
      "this is the one that would otherwise mark every business in the town as booking by phone"
    );
  }

  section("Settling a lead from the index");

  const matchDeps = {
    platforms: [BOOKSY, VAGARO],
    match: MATCH,
    scoringConfig: getScoringConfig(),
    reasoning: new MockReasoningProvider(),
    now: "2026-08-27T00:00:00.000Z",
  };

  {
    const repo = makeRepo();
    await repo.recordCrawl(crawl({ platform: "booksy" }));
    await repo.recordCrawl(crawl({ platform: "vagaro", id: coverageKey({ platform: "vagaro", city: "Miami", state: "FL", industry: "hair-salons" }) }));
    await repo.putListings([listing("Cuts by Jo", "https://booksy.com/en-us/9_jo")]);

    const result = await matchAgainstDirectories(lead(), { ...matchDeps, index: repo });
    check("every platform read and no match means NO online booking", result.lead.onlineBookingStatus === "NONE");
    check("the question is settled", result.resolved);
    check("and it is stamped with the current method", result.lead.analysisVersion === ANALYSIS_VERSION);
    check("the evidence names the towns searched", result.lead.locationEvidence.some((e) => e.includes("Miami")));
  }

  {
    // THE important one, at the level that matters.
    const repo = makeRepo();
    await repo.recordCrawl(crawl({ platform: "booksy" }));
    // Vagaro's directory for Miami was never read.
    const result = await matchAgainstDirectories(lead(), { ...matchDeps, index: repo });
    check(
      "ONE unread directory leaves the booking question UNKNOWN",
      result.lead.onlineBookingStatus === "UNKNOWN",
      result.lead.onlineBookingStatus
    );
    check("the lead is not resolved", !result.resolved);
    check("it is not stamped with the current method", result.lead.analysisVersion === null);
    check("and it names what is missing", result.missingIndexes.length === 1, JSON.stringify(result.missingIndexes));
  }

  {
    const repo = makeRepo();
    await repo.recordCrawl(crawl({ platform: "booksy" }));
    await repo.putListings([
      listing("Bella Hair Studio", "https://booksy.com/en-us/123_bella-hair-studio_hair-salon_15889_miami"),
    ]);
    // Vagaro unread — but being FOUND is a complete answer regardless.
    const result = await matchAgainstDirectories(lead(), { ...matchDeps, index: repo });
    check("being found settles it even with another directory unread", result.resolved);
    check("and the platform is named", result.lead.bookingProvider === "Booksy", String(result.lead.bookingProvider));
    check("it is not discarded — it is kept and scored", result.lead.prospectScore !== null);
  }

  {
    const repo = makeRepo();
    const result = await matchAgainstDirectories(lead(), { ...matchDeps, index: repo });
    check(
      "an unresolved lead is still stamped as attempted",
      result.lead.directoryCheckedAt === matchDeps.now,
      "without the stamp the queue re-runs the same leads forever, ahead of ones nobody has tried"
    );
  }

  section("An unproven platform cannot freeze everything");

  {
    // The deadlock this exists to prevent: add a platform whose URL shape is
    // still a guess, and if it counted toward the negative, one unreadable
    // platform would stop every lead in the database from ever resolving.
    const SQUARE: DirectoryPlatform = {
      id: "square",
      label: "Square Appointments",
      domain: "squareup.com",
      searchUrlTemplate: "https://squareup.com/x",
      profilePathPattern: "/appointments/book/",
      enabled: true,
      requiredForNone: false,
    };

    const repo = makeRepo();
    await repo.recordCrawl(crawl({ platform: "booksy" }));
    await repo.recordCrawl(
      crawl({ platform: "vagaro", id: coverageKey({ platform: "vagaro", city: "Miami", state: "FL", industry: "hair-salons" }) })
    );
    // Square never crawled.
    const result = await matchAgainstDirectories(lead(), {
      ...matchDeps,
      platforms: [BOOKSY, VAGARO, SQUARE],
      index: repo,
    });
    check(
      "an unread BONUS platform does not block the answer",
      result.lead.onlineBookingStatus === "NONE",
      result.lead.onlineBookingStatus
    );
    check(
      "and the evidence names only what was actually searched",
      result.lead.locationEvidence.some((e) => e.includes("Booksy") && e.includes("Vagaro") && !e.includes("Square")),
      result.lead.locationEvidence.join(" | ")
    );

    // But a required one still does.
    const repo2 = makeRepo();
    await repo2.recordCrawl(crawl({ platform: "booksy" }));
    const blocked = await matchAgainstDirectories(lead(), {
      ...matchDeps,
      platforms: [BOOKSY, VAGARO, SQUARE],
      index: repo2,
    });
    check(
      "an unread REQUIRED platform still blocks it",
      blocked.lead.onlineBookingStatus === "UNKNOWN",
      blocked.lead.onlineBookingStatus
    );
  }

  {
    // A bonus platform still gives a complete answer when it FINDS someone.
    const SQUARE: DirectoryPlatform = {
      id: "square",
      label: "Square Appointments",
      domain: "squareup.com",
      searchUrlTemplate: "https://squareup.com/x",
      profilePathPattern: "^/appointments/book/",
      enabled: true,
      requiredForNone: false,
    };
    const repo = makeRepo();
    await repo.recordCrawl(
      crawl({ platform: "square", id: coverageKey({ platform: "square", city: "Miami", state: "FL", industry: "hair-salons" }) })
    );
    await repo.putListings([
      { ...listing("Bella Hair Studio", "https://squareup.com/appointments/book/bella", "square") },
    ]);
    const result = await matchAgainstDirectories(lead(), {
      ...matchDeps,
      platforms: [SQUARE, BOOKSY],
      index: repo,
    });
    check("being found on a bonus platform settles it outright", result.resolved);
    check("and names that platform", result.lead.bookingProvider === "Square Appointments", String(result.lead.bookingProvider));
  }

  {
    // Config with the flag missing everywhere must behave like the old
    // version rather than silently never resolving anything.
    const repo = makeRepo();
    const noFlags = [{ ...BOOKSY, requiredForNone: undefined }, { ...VAGARO, requiredForNone: undefined }];
    await repo.recordCrawl(crawl({ platform: "booksy" }));
    await repo.recordCrawl(
      crawl({ platform: "vagaro", id: coverageKey({ platform: "vagaro", city: "Miami", state: "FL", industry: "hair-salons" }) })
    );
    const result = await matchAgainstDirectories(lead(), { ...matchDeps, platforms: noFlags, index: repo });
    check("a config with no required flags still resolves", result.resolved);
  }

  section("The index survives a re-crawl");

  {
    const repo = makeRepo();
    const first = listing("Bella Hair", "https://booksy.com/en-us/123_bella");
    await repo.putListings([first]);
    await repo.putListings([{ ...first, id: "different-id", businessName: "Bella Hair Studio", crawledAt: "2026-09-01T00:00:00.000Z" }]);
    const stored = await repo.listingsFor({ platform: "booksy", city: "Miami", state: "FL", industry: "hair-salons" });
    check("re-crawling replaces a listing rather than duplicating it", stored.length === 1, String(stored.length));
    check("and takes the newer name", stored[0]?.businessName === "Bella Hair Studio", String(stored[0]?.businessName));
  }

  {
    const repo = makeRepo();
    await repo.recordCrawl(crawl({ status: "failed", detail: "HTTP 429" }));
    await repo.recordCrawl(crawl({ status: "complete", detail: null }));
    const stored = await repo.getCrawl(crawl().id);
    check("a retry overwrites the failure rather than adding a row", stored?.status === "complete", String(stored?.status));
    check("only one crawl row exists for the town", (await repo.countCrawls()) === 1);
  }

  console.log("\n" + "=".repeat(40));
  console.log(`${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`Failed: ${failures.join(", ")}`);
  console.log("=".repeat(40));
  if (failed > 0) process.exitCode = 1;
}

void main();
