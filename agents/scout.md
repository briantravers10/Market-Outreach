# Scout

**Role:** Discovery Agent

## Responsibilities

- Find candidate businesses matching an assigned campaign's city and industry.
- Attach a discovery source to every candidate it produces.
- Avoid obvious duplicates before handing candidates to the Researcher.

## Permitted actions

- Generate/discover candidate businesses for an assigned campaign
- Attach a discovery source to each candidate
- Avoid obvious duplicates before handing off

## Prohibited actions

- Contacting any business
- Scraping or querying real business data sources — mock discovery only, until explicitly authorized
- Scoring or qualifying leads (that's the Qualifier's job)

## Inputs

- A campaign's city, industry, and batch size (from the Manager)

## Expected output

- A batch of candidate businesses (`DiscoveredLeadSeed`), passed to the Researcher

## Escalation

- If a batch turns up zero candidates, Scout creates a `human_review_items` entry and the job moves to `human_review` rather than silently completing empty.

## Implementation note

`packages/core/src/providers/discoveryProvider.ts` — `MockDiscoveryProvider` today, generating deterministic fake businesses. A real `DiscoveryProvider` (Places API, targeted search) implements the same interface later; nothing else in the pipeline changes when that swap happens.

---

## Discovery channels by industry

`config/industries.json` tags each industry with a `discoveryChannel`, because
where a business is findable differs sharply by trade.

### `maps` — storefront industries

Barbers, salons, tattoo studios, and similar have a fixed address and a map
listing. A Places/Maps-style API is the natural primary source, and the address
it returns *is* the location. No inference required.

### `social-first` — Instagram-native industries

Makeup artists are the first of these. They typically have no storefront, often
no website, and take bookings in Instagram DMs. That combination is precisely
what this product exists to fix, so they are a high-value segment — but they are
much harder to *find*, and the naive approach does not work.

**Instagram cannot be the discovery source.** This is a hard platform
constraint, not an engineering gap:

- There is no API to search for accounts by keyword, niche, or location.
  `business_discovery` is a *lookup*: it returns data about an account whose
  username you already have. It cannot answer "who are the makeup artists in
  Miami".
- Hashtag search exists but is capped at roughly 30 unique hashtags per week per
  account, returns recent *media* rather than account contact details, and needs
  a Business/Creator account plus app review.
- Location-based account search is not available.
- Scraping the site to work around this violates Instagram's terms and gets
  blocked quickly. It is not an option this project will take.

**So Instagram is an enrichment source, not a discovery source.** Once a
candidate's handle is known, it is the single best signal available: it shows
whether booking happens in DMs (the strongest buying signal in the scoring
model), how active the business is, and where it works.

**Discovery for social-first industries therefore comes from elsewhere:**

| Source | Why it works | Gives location? |
|---|---|---|
| Maps/Places listings | Many artists still register one, especially suite-based | Yes — exact |
| Salon-suite directories (Sola, Phenix, MY SALON Suite) | Public rosters of independent professionals by location | Yes — exact |
| Booking-platform directories (StyleSeat, Booksy, Vagaro, GlossGenius) | Public profiles with service areas | Yes — usually |
| Bridal directories (The Knot, WeddingWire) | Bridal makeup is a large segment and vendors list explicit service areas | Yes — stated |

Note the second-order signal in the booking-platform directories: an artist
already listed on one **has** integrated booking, which the scoring model treats
as a strong negative (`sophisticated-booking-incumbent`, −20). Their real value
is as an exclusion list — the target is the artist who is *not* on any of them.

### Location inference

Storefronts have an address. Mobile operators have to be placed from weaker,
combinable signals, recorded on the lead as `serviceArea`, `locationConfidence`,
and `locationEvidence`:

- the profile bio naming a city or neighbourhood
- recurring location tags across recent posts — the strongest available signal,
  and the one that survives having no address at all
- a linked booking page stating a service area
- venues and salons tagged repeatedly

Confidence rises with the number of *independent* signals that agree, not with
how confident any single one sounds. Every signal used is stored as evidence so
a human can audit the guess, and a lead with no usable signal is marked `LOW`
with no service area rather than being assigned a plausible-looking guess.

`locationConfidence` is deliberately separate from `dataConfidence`. A mobile
artist with a well-evidenced service area and no street address is
*well-understood*, not *poorly-researched* — collapsing the two would penalise an
entire industry for how it operates.

---

## The link-in-bio page: the highest-signal artifact

For social-first industries, the single most valuable public artifact is the
**link-in-bio page** — Linktree, Beacons, Stan Store, Milkshake and similar —
that nearly every one of these businesses puts in their profile.

**Why it is fair game where Instagram is not.** A link-in-bio page is an
ordinary public web page whose entire purpose is to be opened by strangers.
There is no auth wall and no API terms being worked around. Linktree in
particular embeds every link in a `__NEXT_DATA__` JSON blob in the page HTML,
so a plain HTTP GET plus a JSON parse is enough — no headless browser, no
logged-in session. Instagram fails on both counts, which is why the handle
itself must come from a directory or a search result rather than from crawling
Instagram.

It is also a **discovery** channel, not just an enrichment one: these pages are
publicly indexed, so a search-engine query scoped to a link-in-bio host and a
city surfaces them directly. That is the practical way around the wall
described above.

**What the page answers, in one fetch:**

| Link found | What it means | Effect on score |
|---|---|---|
| GlossGenius / StyleSeat / Booksy / Vagaro / Fresha / Square | Full industry booking platform — a real incumbent | Strong negative |
| Calendly / Acuity / Setmore / HoneyBook | Generic scheduler bolted on | Negative |
| Venmo / Cash App / PayPal / Zelle, **and no booking link** | Collecting deposits by hand while coordinating in DMs | **Strongest positive** |
| WhatsApp / tel: / mailto: only | Enquiries have nowhere to go but the DMs | Positive |
| Nothing but socials | No booking infrastructure at all | Positive |

That middle row is the ideal prospect: enough demand to be taking deposits,
and no system to handle them.

Classification lives in `packages/core/src/enrichment/linkClassifier.ts` and is
deterministic and explainable — every link records *why* it was classified as
it was. The platform registry is `config/link-signals.json`, so adding a
booking platform is a config edit. Where a destination domain is unrecognised
(a custom domain like `book.someartist.com`), the button text is used as a
fallback signal, since those buttons almost always say "Book".

A booking provider identified from a real link always **overrides** the
pipeline's generic guess. Knowing the prospect uses Calendly is a fact; the
analysis worker's placeholder label is not, and overwriting a fact with a guess
would be a regression.
