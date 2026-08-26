/**
 * URL fallback and inner-page crawl test suite.
 *
 * Offline: every page is canned, so this exercises the judgement without
 * touching a single real business's website.
 *
 * Two things are under test, both of which were costing real accuracy:
 *   - a site that answers on `www` but not the bare host used to be recorded
 *     as unreachable, and unreachable used to be recorded as nothing at all
 *   - booking one click in from the homepage used to read as "no booking",
 *     the most expensive wrong answer the model can give
 *
 *   npm run test-site-crawl
 */
import {
  analyzeSite,
  analyzeSiteDeep,
  fetchWithFallback,
  getScoringConfig,
  pickInnerPages,
  urlVariants,
  StubSiteFetcher,
  type FetchedPage,
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

const page = (html: string, finalUrl = "https://salon.example/"): Partial<FetchedPage> => ({
  html,
  finalUrl,
  status: 200,
  error: null,
});

const HOMEPAGE_NO_BOOKING = `
  <html><head><meta name="viewport" content="width=device-width"></head>
  <body><nav>
    <a href="/">Home</a>
    <a href="/services">Our Services</a>
    <a href="/about">About</a>
  </nav><p>Welcome to the salon, a lovely place with plenty of words on the page to
  clear the placeholder threshold. We have been cutting hair for many years and
  we are proud of our team and our work and our little shop on the corner.</p></body></html>`;

const SERVICES_WITH_BOOKING = `
  <html><body><h1>Services</h1>
  <a href="https://squareup.com/appointments/book/abc123">Book an appointment</a>
  </body></html>`;

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  section("URL variants");
  // ---------------------------------------------------------------------------

  {
    const v = urlVariants("https://salon.example/");
    check("a bare host gets a www variant", v.some((u) => u.includes("www.salon.example")));
    check("the original is tried first", v[0].includes("//salon.example"), v[0]);
    check("http is offered as a fallback", v.some((u) => u.startsWith("http://")));
    check("https is always tried before http", v.findIndex((u) => u.startsWith("https:")) < v.findIndex((u) => u.startsWith("http:")));
  }

  {
    const v = urlVariants("https://www.salon.example/");
    check("a www host gets a bare variant", v.some((u) => /\/\/salon\.example/.test(u)));
    check("no duplicate variants", new Set(v).size === v.length);
  }

  {
    check("a non-http scheme yields nothing", urlVariants("ftp://salon.example/").length === 0);
    check("garbage yields nothing", urlVariants("not a url").length === 0);
    check("a private address is refused", urlVariants("http://192.168.1.1/").length === 0);
    check("localhost is refused", urlVariants("http://localhost/").length === 0);
  }

  {
    const v = urlVariants("https://salon.example/pages/book?x=1");
    check("the path is preserved across variants", v.every((u) => u.includes("/pages/book")));
    check("the query is preserved", v.every((u) => u.includes("x=1")));
  }

  // ---------------------------------------------------------------------------
  section("Fetch fallback");
  // ---------------------------------------------------------------------------

  {
    // The exact real-world case: bare host dead, www alive.
    const fetcher = new StubSiteFetcher({
      "https://salon.example/": { error: "getaddrinfo ENOTFOUND", html: "" },
      "https://www.salon.example/": page(HOMEPAGE_NO_BOOKING, "https://www.salon.example/"),
    });
    const { page: got, attempts } = await fetchWithFallback(fetcher, "https://salon.example/");
    check("falls through to the www form", got.error === null, got.error ?? "");
    check("and returns that page's content", got.html.includes("Welcome to the salon"));
    check("the attempts are recorded", attempts.length === 2, `${attempts.length}`);
  }

  {
    const fetcher = new StubSiteFetcher({
      "https://salon.example/": page(HOMEPAGE_NO_BOOKING),
    });
    const { attempts } = await fetchWithFallback(fetcher, "https://salon.example/");
    check("a first-try success does not keep trying", attempts.length === 1);
  }

  {
    // Everything fails — the claim should be stronger than one attempt.
    const fetcher = new StubSiteFetcher({});
    const { page: got, attempts } = await fetchWithFallback(fetcher, "https://salon.example/");
    check("all variants failing yields an error", got.error !== null);
    check("the error says how many forms were tried", (got.error ?? "").includes("tried"), got.error ?? "");
    check("every variant was attempted", attempts.length >= 3, `${attempts.length}`);
  }

  {
    // A 200 with an empty body is not a success.
    const fetcher = new StubSiteFetcher({
      "https://salon.example/": { html: "   ", status: 200, error: null },
      "https://www.salon.example/": page(HOMEPAGE_NO_BOOKING, "https://www.salon.example/"),
    });
    const { page: got } = await fetchWithFallback(fetcher, "https://salon.example/");
    check("an empty body is treated as a failure and falls through", got.html.includes("Welcome"));
  }

  // ---------------------------------------------------------------------------
  section("Picking inner pages");
  // ---------------------------------------------------------------------------

  {
    const picked = pickInnerPages(HOMEPAGE_NO_BOOKING, "https://salon.example/");
    check("a /services link is picked up", picked.some((u) => u.endsWith("/services")));
    check("the homepage itself is never picked", !picked.some((u) => new URL(u).pathname === "/"));
    check("an unrelated /about page is ignored", !picked.some((u) => u.endsWith("/about")));
  }

  {
    const html = `<a href="/reserve-a-chair">Book Now</a><a href="/gallery">Gallery</a>`;
    const picked = pickInnerPages(html, "https://salon.example/");
    check(
      "anchor text wins over path — an odd URL saying 'Book Now' is picked",
      picked.some((u) => u.endsWith("/reserve-a-chair"))
    );
  }

  {
    const html = `<a href="/book">Book</a><a href="https://other.example/book">Book</a>`;
    const picked = pickInnerPages(html, "https://salon.example/");
    check("off-host links are never crawled", !picked.some((u) => u.includes("other.example")));
    check("the same-host one is kept", picked.some((u) => u.endsWith("/book")));
  }

  {
    const html = `<a href="/menu.pdf">Book services</a><a href="/booking">Booking</a>`;
    const picked = pickInnerPages(html, "https://salon.example/");
    check("a PDF is never fetched as a page", !picked.some((u) => u.endsWith(".pdf")));
    check("the real page still is", picked.some((u) => u.endsWith("/booking")));
  }

  {
    const many = Array.from({ length: 20 }, (_, i) => `<a href="/book${i}">Book now</a>`).join("");
    check("the crawl is capped", pickInnerPages(many, "https://salon.example/").length <= 4);
    check("the cap is configurable", pickInnerPages(many, "https://salon.example/", 2).length === 2);
  }

  {
    const dupes = `<a href="/book">Book</a><a href="/book#top">Book now</a><a href="/book">Booking</a>`;
    check("duplicates collapse", pickInnerPages(dupes, "https://salon.example/").length === 1);
  }

  // ---------------------------------------------------------------------------
  section("Deep analysis — booking one click in");
  // ---------------------------------------------------------------------------

  {
    const fetcher = new StubSiteFetcher({
      "https://salon.example/services": page(SERVICES_WITH_BOOKING, "https://salon.example/services"),
    });
    const home = { ...page(HOMEPAGE_NO_BOOKING), error: null } as FetchedPage;

    const shallow = analyzeSite(home, { hasSocialProfile: false });
    check("the homepage alone reads as no booking", shallow.onlineBookingStatus === "NONE");

    const deep = await analyzeSiteDeep(home, (u) => fetcher.fetchPage(u), { hasSocialProfile: false });
    check(
      "the deep read finds the booking on /services",
      deep.onlineBookingStatus !== "NONE",
      deep.onlineBookingStatus
    );
    check("and names the provider", deep.bookingProvider !== null, String(deep.bookingProvider));
    check("the evidence says which page it was on", deep.evidence.some((e) => e.includes("/services")));
    check(
      "the contradicted homepage claim is dropped",
      !deep.evidence.some((e) => e.startsWith("No booking link")),
      deep.evidence.join(" | ")
    );
    check("it reports how many pages it read", deep.pagesRead === 2, String(deep.pagesRead));
  }

  {
    // No booking anywhere: the answer stays NONE, and says the crawl happened.
    const fetcher = new StubSiteFetcher({
      "https://salon.example/services": page("<html><body>Just a list of haircuts and prices.</body></html>", "https://salon.example/services"),
    });
    const home = { ...page(HOMEPAGE_NO_BOOKING), error: null } as FetchedPage;
    const deep = await analyzeSiteDeep(home, (u) => fetcher.fetchPage(u), { hasSocialProfile: false });
    check("still NONE when nothing books anywhere", deep.onlineBookingStatus === "NONE");
    check(
      "and the evidence records that inner pages were checked",
      deep.evidence.some((e) => e.includes("inner page")),
      deep.evidence.join(" | ")
    );
  }

  {
    // Already answered on the homepage — do not spend more requests.
    const homeWithBooking = {
      ...page(`<html><body><a href="https://booksy.com/x">Book</a>${"padding ".repeat(300)}</body></html>`),
      error: null,
    } as FetchedPage;
    let fetches = 0;
    const deep = await analyzeSiteDeep(
      homeWithBooking,
      async (u) => {
        fetches += 1;
        return { finalUrl: u, status: 200, html: "", error: "should not be called" };
      },
      { hasSocialProfile: false }
    );
    check("a homepage that already books is not crawled further", fetches === 0);
    check("and the answer is kept", deep.onlineBookingStatus !== "NONE");
    check("one page read", deep.pagesRead === 1);
  }

  {
    // Unreachable homepage — nothing to crawl, and nothing asserted.
    const dead = { finalUrl: "https://salon.example/", status: 0, html: "", error: "Timed out" } as FetchedPage;
    let fetches = 0;
    const deep = await analyzeSiteDeep(dead, async (u) => {
      fetches += 1;
      return { finalUrl: u, status: 200, html: "", error: null };
    }, { hasSocialProfile: false });
    check("an unreachable homepage is not crawled", fetches === 0);
    check("and stays unreachable", deep.unreachable === true);
    check("booking stays UNKNOWN, never NONE", deep.onlineBookingStatus === "UNKNOWN");
  }

  {
    // An inner page that fails must not derail the rest.
    const fetcher = new StubSiteFetcher({
      "https://salon.example/services": page(SERVICES_WITH_BOOKING, "https://salon.example/services"),
    });
    const html = `<a href="/book">Book now</a><a href="/services">Services</a>`;
    const home = { ...page(html), error: null } as FetchedPage;
    const deep = await analyzeSiteDeep(home, (u) => fetcher.fetchPage(u), { hasSocialProfile: false });
    check(
      "a dead inner page is skipped and the next one still answers",
      deep.onlineBookingStatus !== "NONE",
      deep.onlineBookingStatus
    );
  }

  // ---------------------------------------------------------------------------
  section("Quality bands match what the config can key on");
  // ---------------------------------------------------------------------------

  {
    // The removed `excellent-website` factor keyed on a value nothing emits.
    // This guards the invariant rather than the specific factor.
    const config = getScoringConfig();
    const emittable = new Set(["POOR", "AVERAGE", "GOOD", "UNKNOWN"]);
    const offenders = config.factors.filter((f) => {
      const match = /website_quality = ([A-Z_]+)/.exec(f.appliesWhen ?? "");
      return match !== null && !emittable.has(match[1]);
    });
    check(
      "no scoring factor keys on a website_quality the analyzer cannot produce",
      offenders.length === 0,
      offenders.map((o) => o.id).join(", ")
    );
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
