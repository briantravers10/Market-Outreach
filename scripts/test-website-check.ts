/**
 * Tests for reading a prospect's website.
 *
 * Runs entirely against canned pages, which is the point: the judgement is
 * deterministic and every conclusion should be provable from markup. The one
 * thing these cannot cover is whether the live fetch works, so that seam is
 * tested through a stub and the real HTTP path is exercised only in production.
 *
 *   npm run test-website-check
 */
import {
  analyzeSite,
  assessQuality,
  extractAnchors,
  checkWebsite,
  checkWebsites,
  resolveBatchSize,
  scoreLead,
  isFetchableUrl,
  StubSiteFetcher,
  observationToLead,
  getScoringConfig,
  MockReasoningProvider,
  type FetchedPage,
  type Lead,
  type OvertureObservation,
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

function page(html: string, overrides: Partial<FetchedPage> = {}): FetchedPage {
  return { finalUrl: "https://fadelab.com/", status: 200, html, error: null, ...overrides };
}

const MODERN = `<html><head><meta name="viewport" content="width=device-width"></head><body>
  <p>&copy; 2026 Fade Lab</p>`;

function leadFor(overrides: Partial<OvertureObservation> = {}): Lead {
  const observation: OvertureObservation = {
    overtureId: "id-1",
    name: "Fade Lab",
    industry: "barbers",
    overtureCategory: "barber",
    alternateCategories: [],
    address: "1 Ocean Dr",
    city: "Miami",
    state: "FL",
    zip: "33139",
    websites: ["https://fadelab.com/"],
    phones: ["3055550101"],
    socials: [],
    emails: [],
    confidence: 0.9,
    latitude: 25.7,
    longitude: -80.1,
    ...overrides,
  };
  return observationToLead(observation, { campaignId: "c1", jobId: "j1", now: "2026-08-25T20:00:00.000Z" });
}

async function main() {
  const scoringConfig = getScoringConfig();
  const reasoning = new MockReasoningProvider();
  const deps = { scoringConfig, reasoning, now: "2026-08-25T21:00:00.000Z" };

  section("Refusing to fetch what it should not");
  check("plain https is fine", isFetchableUrl("https://fadelab.com"));
  check("plain http is fine", isFetchableUrl("http://fadelab.com"));
  check("file:// is refused", !isFetchableUrl("file:///etc/passwd"));
  check("localhost is refused", !isFetchableUrl("http://localhost:3000/admin"));
  check("loopback is refused", !isFetchableUrl("http://127.0.0.1/"));
  check("private range is refused", !isFetchableUrl("http://10.0.0.5/"));
  check("link-local metadata address is refused", !isFetchableUrl("http://169.254.169.254/"));
  check("172.16 is refused", !isFetchableUrl("http://172.16.4.1/"));
  check("172.32 is public and allowed", isFetchableUrl("http://172.32.4.1/"));
  check("nonsense is refused", !isFetchableUrl("not a url"));

  section("Pulling links out of markup");
  const anchors = extractAnchors(
    `<a href="/about">About</a><a href="https://booksy.com/x">Book Now</a><a href="#top">Top</a>
     <a href="javascript:void(0)">Menu</a><a href='https://instagram.com/fadelab'><img> @fadelab </a>`,
    "https://fadelab.com/"
  );
  check("relative links are resolved", anchors.some((a) => a.href === "https://fadelab.com/about"));
  check("fragment links are skipped", !anchors.some((a) => a.href.includes("#top")));
  check("javascript: links are skipped", !anchors.some((a) => a.href.startsWith("javascript")));
  check("anchor text is cleaned of tags", anchors.some((a) => a.text === "@fadelab"), JSON.stringify(anchors.map(a => a.text)));
  check("the three real links are found, the two junk ones are not", anchors.length === 3, String(anchors.length));

  section("Detecting an incumbent");
  const booksy = analyzeSite(page(`${MODERN}<a href="https://booksy.com/en-us/1234_fade-lab">Book Now</a>`), {
    hasSocialProfile: false,
  });
  check("integrated platform recognised", booksy.onlineBookingStatus === "INTEGRATED_BOOKING_SYSTEM", booksy.onlineBookingStatus);
  check("provider named", booksy.bookingProvider === "Booksy", String(booksy.bookingProvider));
  check("booking method follows", booksy.bookingMethod === "ONLINE_INTEGRATED");
  check("evidence names the platform", booksy.evidence.some((e) => e.includes("Booksy")));

  const calendly = analyzeSite(page(`${MODERN}<a href="https://calendly.com/fadelab">Schedule</a>`), {
    hasSocialProfile: false,
  });
  check("generic scheduler is third-party, not integrated",
    calendly.onlineBookingStatus === "THIRD_PARTY_BOOKING_SYSTEM", calendly.onlineBookingStatus);

  section("Detecting no incumbent");
  const bare = analyzeSite(page(`${MODERN}<a href="https://twitter.com/fadelab">Twitter</a>`), { hasSocialProfile: true });
  check("no booking link means NONE", bare.onlineBookingStatus === "NONE", bare.onlineBookingStatus);
  check("with a social profile, enquiries are DMs", bare.bookingMethod === "SOCIAL_DM", bare.bookingMethod);
  check("without one, it is the phone",
    analyzeSite(page(MODERN), { hasSocialProfile: false }).bookingMethod === "PHONE_ONLY");

  section("An in-house booking page is still online booking");
  const inHouse = analyzeSite(page(`${MODERN}<a href="https://fadelab.com/book">Book an appointment</a>`), {
    hasSocialProfile: false,
  });
  check("a 'book' link to their own site is not scored as NONE",
    inHouse.onlineBookingStatus !== "NONE", inHouse.onlineBookingStatus);
  check("but no provider is invented", inHouse.bookingProvider === null);
  check("and it says to go and look", inHouse.evidence.some((e) => e.includes("worth a look")));

  section("An unreachable site asserts nothing");
  for (const [label, bad] of [
    ["timeout", page("", { error: "Timed out after 8000ms", status: 0 })],
    ["404", page(MODERN, { status: 404 })],
    ["empty body", page("")],
  ] as [string, FetchedPage][]) {
    const result = analyzeSite(bad, { hasSocialProfile: true });
    check(`${label}: booking stays UNKNOWN`, result.onlineBookingStatus === "UNKNOWN", result.onlineBookingStatus);
    check(`${label}: quality stays UNKNOWN`, result.websiteQuality === "UNKNOWN");
    check(`${label}: flagged unreachable`, result.unreachable);
  }

  section("Website quality, from markup only");
  check("modern page is not POOR", assessQuality(MODERN, page(MODERN)).quality !== "POOR");
  const dated = `<html><body><p>Copyright 2014 Fade Lab</p>${"x".repeat(3000)}</body></html>`;
  check("no viewport plus a stale copyright is POOR", assessQuality(dated, page(dated)).quality === "POOR",
    assessQuality(dated, page(dated)).quality);
  check("the reason is stated", assessQuality(dated, page(dated)).evidence.some((e) => e.includes("2014")));
  check("plain HTTP is called out",
    assessQuality(MODERN, page(MODERN, { finalUrl: "http://fadelab.com/" })).evidence.some((e) => e.includes("not secure")));
  check("empty html gives UNKNOWN, not a verdict", assessQuality("", page("")).quality === "UNKNOWN");

  section("End to end: reading a site changes the score");
  const before = leadFor({ socials: ["https://www.instagram.com/fadelab"] });
  // Score it the way the importer would, rather than inventing a baseline —
  // comparing against a made-up number proves nothing about the change.
  const baseline = await scoreLead(before, scoringConfig, reasoning);
  before.prospectScore = baseline.score;
  const noBooking = await checkWebsite(before, {
    ...deps,
    fetcher: new StubSiteFetcher({ "https://fadelab.com/": { html: MODERN } }),
  });
  check("booking is now answered", noBooking.lead.onlineBookingStatus === "NONE", noBooking.lead.onlineBookingStatus);
  check("the score went up", (noBooking.scoreAfter ?? 0) > baseline.score, `${baseline.score} -> ${noBooking.scoreAfter}`);
  check("website analysis is now claimed", noBooking.lead.stagesCompleted.includes("website_analysis"));
  check("the site was stamped as checked", noBooking.lead.websiteCheckedAt === deps.now);
  check("the original discovery evidence survives",
    noBooking.lead.locationEvidence.some((e) => e.includes("Overture Maps")));

  const incumbent = await checkWebsite(before, {
    ...deps,
    fetcher: new StubSiteFetcher({
      "https://fadelab.com/": { html: `${MODERN}<a href="https://vagaro.com/fadelab">Book</a>` },
    }),
  });
  check("an incumbent scores lower than no booking",
    (incumbent.scoreAfter ?? 0) < (noBooking.scoreAfter ?? 0),
    `${incumbent.scoreAfter} vs ${noBooking.scoreAfter}`);
  check("the provider is recorded for the call", incumbent.lead.bookingProvider === "Vagaro");

  section("A dead site is marked checked, not left to retry forever");
  const dead = await checkWebsite(before, { ...deps, fetcher: new StubSiteFetcher({}) });
  check("stamped as checked", dead.lead.websiteCheckedAt === deps.now);
  check("but booking is still unanswered", dead.lead.onlineBookingStatus === "UNKNOWN");
  check("and website analysis is NOT claimed", !dead.lead.stagesCompleted.includes("website_analysis"));
  // The gap this closes: a failed fetch used to write nothing but the
  // timestamp, leaving websiteStatus reading EXISTS. Nineteen thousand leads
  // sat in that state, indistinguishable from never-tried and impossible to
  // retry as a group.
  check("the site is recorded as unreachable", dead.lead.websiteStatus === "UNREACHABLE", dead.lead.websiteStatus);
  check("which is not the same as having no website", dead.lead.websiteStatus !== "NONE");
  check("and the summary says how many URL forms were tried", dead.summary.includes("URL form"), dead.summary);
  check("research status is not upgraded on a site nobody read", dead.lead.researchStatus !== "ANALYZED");

  section("Progress is saved as it goes, not only at the end");
  // The bug this guards cost a day of throughput and looked like nothing was
  // wrong: the cron fetched 800 sites every ten minutes inside a budget that
  // killed it before the single end-of-run write, so hours of work were
  // discarded and the queue never moved.
  {
    const batch = Array.from({ length: 12 }, (_, i) =>
      leadFor({ overtureId: `flush-${i}`, name: `Flush ${i}`, websites: [`https://flush${i}.com/`] })
    );
    const flushes: number[] = [];
    const saved: string[] = [];
    const results = await checkWebsites(batch, {
      ...deps,
      fetcher: new StubSiteFetcher({}),
      concurrency: 2,
      flushEvery: 5,
      onFlush: async (chunk) => {
        flushes.push(chunk.length);
        saved.push(...chunk.map((r) => r.lead.id));
      },
    });
    check("work is flushed more than once", flushes.length > 1, `${flushes.length} flush(es)`);
    check("every result is saved exactly once", saved.length === results.length, `${saved.length} vs ${results.length}`);
    check("no lead is saved twice", new Set(saved).size === saved.length);
    check(
      "the trailing partial batch is flushed too",
      saved.length % 5 !== 0 || flushes[flushes.length - 1] <= 5
    );
  }
  {
    // No callback must behave exactly as before.
    const batch = [leadFor({ overtureId: "noflush", name: "No Flush", websites: ["https://x.com/"] })];
    const results = await checkWebsites(batch, { ...deps, fetcher: new StubSiteFetcher({}) });
    check("omitting onFlush still returns every result", results.length === 1);
  }

  section("Batch size from a query parameter");
  // The bug this guards: an absent parameter parsed as 0, which is finite, so
  // the clamp produced a batch of one and every scheduled run checked a single
  // website while reporting success.
  check("an absent parameter uses the default", resolveBatchSize(null, 400, 1000) === 400, String(resolveBatchSize(null, 400, 1000)));
  check("an empty parameter uses the default", resolveBatchSize("", 400, 1000) === 400);
  check("zero is not an override", resolveBatchSize("0", 400, 1000) === 400);
  check("a negative number is not an override", resolveBatchSize("-5", 400, 1000) === 400);
  check("nonsense is not an override", resolveBatchSize("lots", 400, 1000) === 400);
  check("an explicit number is honoured", resolveBatchSize("25", 400, 1000) === 25);
  check("and is capped", resolveBatchSize("99999", 400, 1000) === 1000);
  check("a fractional number is floored", resolveBatchSize("12.9", 400, 1000) === 12);

  section("Batching");
  const many = Array.from({ length: 12 }, (_, i) =>
    leadFor({ overtureId: `id-${i}`, name: `Shop ${i}`, websites: [`https://shop${i}.com/`] })
  );
  const stub = new StubSiteFetcher(
    Object.fromEntries(many.map((l) => [l.website as string, { html: MODERN }]))
  );
  const batch = await checkWebsites(many, { ...deps, fetcher: stub, concurrency: 4 });
  check("every lead in the batch is processed", batch.length === 12, String(batch.length));
  check("each was checked exactly once", new Set(batch.map((r) => r.lead.id)).size === 12);
  check("all reachable", batch.every((r) => r.reachable));

  const deadlined = await checkWebsites(many, { ...deps, fetcher: stub, concurrency: 1, deadlineMs: 0 });
  check("a passed deadline stops work rather than running the batch", deadlined.length === 0, String(deadlined.length));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log(`Failures:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
