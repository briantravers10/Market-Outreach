import { analyzeLinks, classifyLink, type DetectedLink, type LinkAnalysis } from "../enrichment/linkClassifier";
import { getLinkSignals } from "../config";
import { chance, intBetween, makeSeededRandom, pick, type Rng } from "../mockData/random";

/** A raw link as it appears on a link-in-bio page, before classification. */
export interface RawBioLink {
  url: string;
  label: string | null;
}

export interface LinkInBioProfile {
  /** The page the links came from. */
  sourceUrl: string;
  /** Which host it was on ("Linktree", "Beacons"...). */
  host: string;
  links: DetectedLink[];
  analysis: LinkAnalysis;
}

/**
 * Reads a prospect's link-in-bio page.
 *
 * SEAM. A real implementation fetches the page over plain HTTP and parses it —
 * for Linktree specifically, every link is present in the `__NEXT_DATA__` JSON
 * blob Next.js embeds in the HTML, so no headless browser is required. Other
 * hosts (Beacons, Stan Store, Milkshake) need their own parse step, which is
 * why the interface returns already-normalised RawBioLinks rather than HTML.
 *
 * Worth being precise about why this is a legitimate source where scraping
 * Instagram is not: a link-in-bio page is a public web page whose entire
 * purpose is to be opened by strangers. It has no auth wall and no API terms
 * being circumvented. Instagram is the opposite on both counts, which is why
 * the handle itself has to come from a directory or search result rather than
 * from crawling Instagram — see agents/scout.md.
 */
export interface LinkInBioProvider {
  readonly sourceName: string;
  /** Returns null when the business has no link-in-bio page. */
  fetchProfile(url: string | null): Promise<LinkInBioProfile | null>;
}

/** Classifies an already-fetched set of links. Shared by mock and future real providers. */
export function buildProfile(
  sourceUrl: string,
  host: string,
  raw: RawBioLink[],
  /**
   * Optional reachability verdict per link. A real implementation would supply
   * this from an actual HEAD request; the mock supplies a deterministic one.
   * Omitted entirely, every link stays `reachable: null` — "not checked" —
   * rather than being optimistically assumed live.
   */
  checkReachable?: (link: RawBioLink) => boolean | null
): LinkInBioProfile {
  const links = raw.map((l) => {
    const classified = classifyLink(l.url, l.label);
    return checkReachable ? { ...classified, reachable: checkReachable(l) } : classified;
  });
  return { sourceUrl, host, links, analysis: analyzeLinks(links) };
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

const BOOKING_SAMPLES: RawBioLink[] = [
  { url: "https://www.glossgenius.com/artists/example", label: "Book Now" },
  { url: "https://www.styleseat.com/m/example", label: "Book an Appointment" },
  { url: "https://booksy.com/en-us/000000_example", label: "Booksy" },
  { url: "https://calendly.com/example/bridal-trial", label: "Bridal Trial" },
  { url: "https://app.acuityscheduling.com/schedule.php?owner=000000", label: "Schedule" },
  { url: "https://example.square.site/", label: "Book" },
];

const PAYMENT_SAMPLES: RawBioLink[] = [
  { url: "https://venmo.com/u/example", label: "Deposit to secure your date" },
  { url: "https://cash.app/$example", label: "Deposits" },
  { url: "https://paypal.me/example", label: "Pay balance" },
];

const CONTACT_SAMPLES: RawBioLink[] = [
  { url: "https://wa.me/10000000000", label: "Text to book" },
  { url: "mailto:hello@example.example", label: "Email me" },
  { url: "tel:+10000000000", label: "Call" },
];

const EXTRA_SAMPLES: RawBioLink[] = [
  { url: "https://www.tiktok.com/@example", label: "TikTok" },
  { url: "https://g.page/r/example/review", label: "Leave a review" },
  { url: "https://example.example/services", label: "Price List" },
  { url: "https://www.pinterest.com/example", label: "Portfolio" },
];

/**
 * Generates a deterministic, plausible link-in-bio page. No network calls.
 *
 * The distribution matters more than the specific links: roughly half of these
 * businesses have no booking link at all, which is what makes them targets.
 */
export class MockLinkInBioProvider implements LinkInBioProvider {
  readonly sourceName = "mock-link-in-bio-v1";

  async fetchProfile(url: string | null): Promise<LinkInBioProfile | null> {
    if (!url) return null;

    const rng = makeSeededRandom(`${url}|bio`);
    const hosts = getLinkSignals().linkInBioHosts;
    const host = pick(rng, hosts.slice(0, 4)).name;

    const raw: RawBioLink[] = [{ url: "https://www.instagram.com/example", label: "Instagram" }];

    // ~45% already have online booking — those are the ones with an incumbent.
    if (chance(rng, 0.45)) raw.push(pick(rng, BOOKING_SAMPLES));
    // Manual deposit collection is common, and especially telling without a booking link.
    if (chance(rng, 0.5)) raw.push(pick(rng, PAYMENT_SAMPLES));
    if (chance(rng, 0.7)) raw.push(pick(rng, CONTACT_SAMPLES));

    const extras = intBetween(rng, 0, 2);
    for (let i = 0; i < extras; i++) raw.push(pick(rng, EXTRA_SAMPLES));

    // De-duplicate identical sample picks.
    const seen = new Set<string>();
    const unique = raw.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));

    // Roughly one booking link in eight is dead. This is not decoration: a
    // business that put a booking link in its bio has already decided it wants
    // online booking, and a broken one means it is losing every customer who
    // taps it — the strongest pitch in the whole dataset. Non-booking links are
    // left unchecked (null) because nothing in the pipeline acts on them.
    const reachability = (link: RawBioLink): boolean | null => {
      const classified = classifyLink(link.url, link.label);
      if (classified.purpose !== "booking") return null;
      return !chance(makeSeededRandom(`${url}|${link.url}|reachable`), 0.125);
    };

    return buildProfile(url, host, unique, reachability);
  }
}

/** Builds a plausible link-in-bio URL for a mock business. */
export function mockBioUrl(rng: Rng, handle: string): string | null {
  if (!chance(rng, 0.8)) return null; // some have nothing in the bio at all
  const host = pick(rng, ["linktr.ee", "beacons.ai", "stan.store", "linktr.ee"]);
  return `https://${host}/${handle.replace(/^@/, "")}`;
}
