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
