# Needs your input

Things I could not finish myself, because they need a credential, an account
setting, or a decision that is yours to make. Each one says exactly what to do
and what happens if you don't.

Nothing here is broken. Everything below is built and tested; these are the
switches that turn parts of it on.

---

## 1. The dashboard is still publicly readable — set the login variables

**Status:** blocking, if this ever holds anything you care about.

Nobody has to log in to read the deployed dashboard today. The whole login
system is built and tested; it just isn't switched on.

In Vercel → **market-outreach** → Settings → Environment Variables, add:

```
SESSION_SECRET      rlDS-Z84tuFqON8FRhI_spZwUsMiBPsbIuDJ9939P8I
ADMIN_EMAIL         travers.brian10@gmail.com
ADMIN_PASSWORD_HASH scrypt$16384$8$1$2660549b19f4a24483d4de78117c5d57$ee9fde0955a6d0eab192b47e7a099feecd9b2cfc7100581b0f0c7359774aaa1fb3b33b4a7601e56b9a76904339dc750f1edce88751eaac6802afb72544ec5229
```

The password those correspond to is **`harbor-harbor-quarry-14f3`**. Save it —
the hash cannot be turned back into it. Change it once you're in.

---

## 2. `DATABASE_URL` — makes anything you do persist

**Status:** blocking for real use.

Without it the deployment reads a frozen snapshot and nothing you do survives
the request. With it, campaigns, instructions, conversations and reports all
persist.

Supabase → project **Market Outreach** → Settings → Database → Connection string
→ **Transaction pooler**. Copy it, replace `[YOUR-PASSWORD]` with your database
password (resettable on that same page if you never saved it), and add it as
`DATABASE_URL` in Vercel.

**Set the login variables first or at the same time.** A database attached with
no login configured now makes the app refuse to serve (503) rather than publish
itself. That is deliberate.

### Correction to something I told you earlier

I previously said to "delete `DEMO_READ_ONLY` in Vercel". **That would not have
worked** — it is pinned in `apps/dashboard/vercel.json`, which overrides the
dashboard setting. You do not need to do anything about it: `DATABASE_URL` now
cancels demo mode in code, so attaching a database is enough. Removing the line
from `vercel.json` is a one-line change I can make whenever you want it gone
for good.

---

## 3. `ANTHROPIC_API_KEY` — free-form conversation with the Manager

**Status:** optional. Costs money. Your call.

**What works now, without it:** the Manager understands a defined set of request
shapes by pattern-matching, and every capability behind them is completely real.
Briefings, team status, leads, score explanations, instructions (permanent and
temporary), undo, campaigns, reports, archive, scheduling — all of it works
today and all of it reads from the actual database.

**What the key adds:** the ability to phrase things however you like. Right now
"give me my briefing" works and "so what's the story this morning then" doesn't.
The key changes only *how well requests are understood* — never what the Manager
can do.

To turn it on: get a key from console.anthropic.com, add `ANTHROPIC_API_KEY` in
Vercel. Optionally `ANTHROPIC_MODEL` (defaults to `claude-sonnet-4-5`). The
Manager page tells you which mode it's in, so you'll never be guessing.

**Cost:** roughly a fraction of a penny per exchange. A heavy day of use is
pennies, not pounds. I did not add this myself because your standing rule is no
paid APIs without asking.

**Tested how far:** the request building, tool definitions and response handling
are unit-tested against a stand-in transport, including the case where the model
names a tool that doesn't exist. **The live HTTP call has never been made** —
there is no key here to make it with. I expect it to work; I have not proven it.
The first real message will tell us, and a failure is reported in the chat
rather than swallowed.

---

## 4. `CRON_SECRET` — makes scheduled reports actually fire

**Status:** needed for "every morning at 9" to mean anything.

Schedules are stored properly today, and the Scheduled page says plainly whether
anything is firing them. The endpoint that runs them is built and tested; it
refuses to run without a secret.

1. Generate any long random string.
2. Add it as `CRON_SECRET` in Vercel.
3. Vercel Cron is already configured in `apps/dashboard/vercel.json` to call
   `/api/cron/run-scheduled` every 15 minutes. On Hobby plans Vercel limits cron
   frequency — if it won't accept 15 minutes, change the `schedule` there to
   `0 * * * *` (hourly).

**Known limitation — timezones.** Schedules are evaluated in UTC. A "9am"
schedule fires at 09:00 UTC, which is not 9am for you for half the year. Doing
this correctly needs a timezone library; guessing at daylight-saving arithmetic
would produce a schedule that silently drifts by an hour twice a year, which is
worse than a documented offset. Tell me if you want it and I'll add it properly.

---

## 5. Decisions that are yours, not mine

These have been open a while. None of them blocks anything.

- **Deduplication rule.** I tightened it so two businesses sharing only a name
  are no longer merged — it was discarding real leads. Made without your
  sign-off. Say the word and I'll revert it.
- **Which trades are premises-based vs mobile.** I guessed for the original ten
  industries (`config/industries.json`). You'd know better.
- **Real booking platforms.** `config/link-signals.json` drives what counts as
  "already has online booking". Adding the ones you actually see in the wild
  makes scoring sharper.
- **Chain detection is name-based.** A business is treated as a chain if its name
  contains "nation", "express" or "group", or if it has more than one location on
  record. That's a heuristic, which is why the Manager says "looks like a chain"
  rather than asserting it. Real chain data would need a real data source.

---

## 6. The big one: the data is still synthetic — and what real costs

Not a credential — a decision.

Every business in the system is invented. The machine around them is real: the
pipeline, the scoring, the Manager, the instructions, the reports, the audit
trail. The businesses are not.

Below is the costing you asked for. **Read the caching problem first** — it is
the part that changes the shape of the build, not just the bill.

### What Google Places would cost

Pricing is per *call*, and one Text Search call returns up to 20 businesses, so
the useful unit is cost-per-business, not cost-per-call.

| | |
|---|---|
| Text Search, with phone + website + rating in the field mask | **$35 per 1,000 calls** |
| Businesses per call | up to **20** (max 3 pages, so **60 per query**) |
| Cost per business | **$0.0018 – $0.0023** |
| Free every month | conservatively **1,000 calls** (~15,000–20,000 businesses) |

Google bills a call at the highest tier of any field asked for. Name and address
alone is the cheaper "Pro" rate; the moment we ask for phone, website or review
count it re-prices to "Enterprise" at $35. That $3 difference per 1,000 calls is
not worth optimising — we need those fields.

**At your current territory list, this is free.** Three cities x eleven
industries x three pages is 99 calls. The free allowance is around 1,000 calls a
month. You would have to grow to roughly thirty cities, swept at full depth every
month, before Google charges you anything at all.

Past that: **about $2 per 1,000 businesses found.** Ten thousand businesses is
around $20.

### The 60-result ceiling

Any one query returns at most 60 results, however many businesses actually exist.
"Every barber in Miami" is not one query — it is a grid of smaller searches by
area, deduplicated by place ID. That is engineering work, not extra cost (each
grid cell is still a call, and calls are what is free).

### The caching problem — the real constraint

Google's Places policy does not let you warehouse what it returns. Place IDs can
be stored indefinitely. Business names, phone numbers, websites and ratings
cannot be kept in a permanent database — they are meant to be fetched live and
shown with attribution.

Our entire product is a permanent lead database you review in a spreadsheet. So
the naive version — "call Places, save the row, export to CSV" — is not something
I am willing to build without you knowing that is what it is.

The version that works:

> **Places tells us who exists and where. Their own website tells us everything
> we keep.**

We store the place ID and our own derived findings. Phone, email, socials,
services and the booking signal come from fetching the business's own site,
which we are entitled to keep. The CSV you download is then our research, not
Google's data re-sold.

That is also the better product. Which brings us to the thing Places cannot
answer at all.

### What Places does not give you

Places returns: name, address, phone, website, rating, review count, category.

Places does **not** return: email, Instagram or Facebook, staff count, website
quality, link-in-bio — or **whether they already book online, and with whom**.

That last one is the entire scoring model. Places cannot tell us the one thing we
most need to know. It comes from fetching the site and reading the links, which
is work we are already half-way through: `config/link-signals.json` and
`packages/core/src/enrichment/linkClassifier.ts` already know what a GlossGenius,
Vagaro or Square booking link looks like. That path costs nothing per business —
just our own HTTP requests.

Optional on top: an LLM judging the fetched page for quality. Roughly $5 per
1,000 businesses with a small model — more than Places itself. Better used only
on the ambiguous cases the deterministic classifier can't call.

### Makeup artists stay unsolved

They are `social-first` for a reason: they are not on Maps. Places will not find
them, and Instagram has no clean, permitted way to search for businesses you do
not own. That industry needs its own decision and its own answer — it is not part
of this price.

### What it costs in work, not money

1. `GooglePlacesDiscoveryProvider` — the seam already exists, so this drops into
   `DiscoveryProvider` with no changes anywhere else. Grid partitioning,
   pagination, place-ID dedup.
2. `WebsiteEnrichmentProvider` — the larger half. Fetch the site, find the
   contact page, extract phone/email/socials, run the existing link classifier
   for the booking signal.
3. A hard spend cap in config with a kill switch, so a runaway campaign cannot
   quietly spend your money. Non-negotiable, given whose card it is.
4. Both behind an env var, falling back to the mocks when no key is set — so
   nothing breaks and you can compare the two side by side.

### Before I build any of it

- **Check Google's own pricing page.** This environment blocks
  `developers.google.com`, so the figures above come from secondary sources. The
  structure is right; verify the rate.
- **Read the Places policy on caching yourself**, or have someone who should.
  I am not a lawyer and I could not fetch the primary text from here. The
  place-ID-plus-own-research design above is built to stay inside it, but that is
  my reading, not a ruling.

Until then the correct mental model is: a finished machine running on fake fuel.
