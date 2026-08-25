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

## 6. The businesses are real now — here is what to do next

**Status:** ready for you. Nothing blocking.

Florida is loaded: **77,325 real businesses** from the Overture Maps open
dataset, across 714 towns and cities, all scored. 21,577 of them have no website
at all, and almost all of those have a phone number. No API key, no bill, and a
licence that lets us keep the data.

### Load it into your live database

Go to **Import** in the sidebar and press **Import Florida**. It runs in the
browser and takes a few minutes; leave the tab open. Safe to run twice — a
second run refreshes rather than duplicating.

### Why nothing says "Qualified" yet

That is correct rather than broken, and it is worth understanding before you
judge the list.

The single biggest factor in the score is whether a business already takes
bookings online. Finding that out means fetching their website and reading it,
which has not happened yet. Rather than guess, the system records "not checked"
and awards no points either way. So the scores are compressed and nothing
crosses the Qualified line.

**What you can act on today** is the no-website cohort: sort Leads by score and
they are at the top. A salon with no website and an active Instagram is the
strongest signal available without visiting a single page.

### The next real step

Fetching each business's website and detecting their booking setup. That is what
unlocks the rest of the score, and the link classifier for it is already built
and tested (`config/link-signals.json`). It costs nothing per business — just
our own requests. Say the word.

### Still open

- **Which states next.** I would sequence by market size and register quality;
  you may have commercial reasons that beat both.
- **`beauty-salons` and `day-spas`** are new industries, added because Overture
  has 15,464 and 10,593 of them in Florida and folding them into hair salons
  would have quietly corrupted the per-industry numbers. Merge them later if the
  calls tell you they are really the same trade.
- **Excluded on purpose:** medical spas (different buyer, different regulation),
  tanning salons, and beauty retail. All one line in
  `config/overture-categories.json` if you disagree.
