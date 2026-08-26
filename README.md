# Market Outreach — AI Prospecting System (Skeleton Phase)

This repo is the **architecture skeleton** for an AI-powered prospecting system that will
eventually find, research, score, and hand off local-service-business leads for an
appointment-booking SaaS platform. **This phase runs on fake/test data only.**

It's structured as a **hybrid AI prospecting team**: one Manager persona the user talks to
in natural language, backed by reusable specialist "agents" (Scout, Researcher, Website
Analyst, Qualifier, Deduplication, Reporting). The specialists are the *same* deterministic
pipeline as before, wearing a persona — real code does real work, and AI is reserved for
the one place it earns its keep this phase: interpreting natural-language commands.

## What this is NOT

- No live business discovery or scraping. Discovery reads a published open
  dataset (Overture Maps) rather than crawling anyone's site.
- No outreach of any kind — see below. Finding and scoring businesses is the
  whole of what this does.
- No outreach. `packages/core/src/outreach/outreachService.ts` never sends email or SMS —
  every attempt is logged with `status: "DISABLED"`. Resend/Twilio are not installed as
  dependencies anywhere in this repo. The Outreach agent and `/outreach` page are visibly
  present but disabled.
- No CRM connection. `mock_crm_records` previews what a future CRM hand-off would look
  like; it is a local SQLite table, not an integration. The CRM agent and `/crm` page are
  visibly present but disabled.
- No live AI calls per job. Command parsing is deterministic pattern-matching this phase
  (see "Natural-language commands" below) — the seam for a real LLM call exists but isn't
  wired up, since that needs API billing the user hasn't authorized yet.
- Fully isolated from the booking-platform product: separate repo, separate local SQLite
  database, no production credentials of any kind.

## The team

| Persona | Role | Implementation this phase |
|---|---|---|
| **Manager** | Takes natural-language commands, creates campaigns | `nlp/commandParser.ts` (deterministic) + `ProspectingManager.assignTask` |
| **Scout** | Discovery — finds candidate businesses | `MockDiscoveryProvider` via `runDiscoveryWorker` |
| **Researcher** | Enrichment — researches a business in depth | `MockEnrichmentProvider` via `runEnrichmentWorker` |
| **Website Analyst** | Judges website/booking quality | `runWebsiteBookingAnalysisWorker` |
| **Qualifier** | Scores leads 0–100 against `config/scoring-config.json` | `runQualificationWorker` / `scoringEngine.ts` |
| **Deduplication** | Flags likely-duplicate businesses | `findLikelyDuplicate` |
| **Reporting** | Aggregates campaign/lead stats for the dashboard | `reportingWorker.ts` |
| **CRM** *(disabled)* | Future hand-off to a real CRM | not built — `/crm`, `/team/crm` show why |
| **Outreach** *(disabled)* | Future email/SMS/call outreach | not built — `/outreach`, `/team/outreach` show why |

Each persona has a human-readable spec (role, responsibilities, permitted/prohibited
actions, inputs/outputs, escalation) in `agents/*.md`. These are documentation contracts
for the code, not executable configs — there's no per-agent LLM process; a persona's
identity comes from `config/agents.json` (static), and its live **status** (Working/Idle),
**current task**, and counters are all *derived* from the `agent_activity` log rather than
stored as mutable state, so they can never drift out of sync with what the pipeline
actually did. See `packages/core/src/agents/agentRegistry.ts`.

## Pipeline

```
DISCOVER -> ENRICH -> ANALYZE (website/booking) -> QUALIFY (score) -> DEDUP -> STORE -> REPORT
```

Implemented in `packages/core/src/prospectingManager.ts`, driven per **job** (a
city + industry + batch unit of work). Every stage writes an `agent_activity` row
attributed to the matching persona, and appends to `leads.stages_completed` so the
dashboard can show a live per-lead checklist. Qualification always runs and its result is
kept even for a lead that turns out to be a duplicate — the Qualifier's score is never
hidden, duplicates are just marked `DISQUALIFIED` with `isDuplicateOf` set.

## Natural-language commands

The Manager Command Box (`/campaigns`) and each agent's direct command box
(`/team/[agentId]`) both go through `packages/core/src/nlp/commandParser.ts`. The
`CommandParser` interface has one implementation today, `DeterministicCommandParser`:
matches industry against `config/industries.json`, city against `config/territories.json`,
extracts a quantity (regex, default 15) and known filter phrases ("no online booking" ->
`NO_ONLINE_BOOKING`, etc.). High-confidence matches (industry + city both found) create a
campaign immediately; anything else returns a clarification message instead of guessing.
This is a real, working parser for the example-shaped commands the product spec calls
for — swapping in a live LLM call later is a matter of a new `CommandParser`
implementation, not a rearchitecture.

## Project structure

```
agents/                    Human-readable spec per persona (role, responsibilities,
                           permitted/prohibited actions, escalation)
config/                    Editable JSON: territories, industries, scoring weights, agents
packages/
  core/                    Domain types, workers, scoring engine, queue manager,
                           orchestrator (ProspectingManager), NL command parser,
                           agent registry/activity log, provider interfaces
  db/                      SQLite schema + repository implementations of core's ports
apps/
  dashboard/               Next.js internal dashboard (App Router) — Overview, Team,
                           Campaigns, Leads, Analytics, Settings, plus disabled CRM/
                           Outreach stubs
scripts/
  seed.ts                  Populates fake campaigns/jobs/leads across all territories x industries
  run-campaign.ts          Drains pending jobs for running campaigns, prints a report
  reset-db.ts              Deletes the local SQLite file
  encode-demo-db.mjs        Regenerates the base64-embedded copy of data/demo.db used
                           by the public read-only Vercel demo
data/                      Local SQLite file lives here (gitignored, except demo.db —
                           see "Public demo" below)
```

## Getting started

```bash
npm install
npm run seed          # generates fake campaigns/jobs/leads (idempotent — resets first)
npm run dashboard      # http://localhost:3000
```

Other useful scripts:

```bash
npm run run-campaign                          # drain all pending jobs in running campaigns
npm run run-campaign -- --campaign=<id>        # drain a single campaign
npm run reset-db                              # wipe local data
npm run typecheck                             # typecheck all workspaces
```

## Configuration (editable without touching code)

- `config/territories.json` — target cities (currently 3 example FL cities)
- `config/industries.json` — target industries. Each carries a `locationModel`
  (`premises` / `mobile` / `hybrid`) and a `discoveryChannel` (`maps` /
  `social-first`), which together tell the pipeline whether a street address is
  expected and where the industry is realistically findable. Makeup artists are
  the first `social-first` + `mobile` entry — see `agents/scout.md` for why
  Instagram is an *enrichment* source rather than a *discovery* source, and how a
  service area gets inferred when there's no address to read.
- `config/scoring-config.json` — prospect-score point weights, thresholds for
  HIGH/MEDIUM/LOW data confidence, and QUALIFIED/HIGH_PRIORITY/DISQUALIFIED cutoffs
- `config/agents.json` — the agent roster: identity, role, description, permitted/
  prohibited actions per persona. Editing this changes what the Team/Settings pages
  display, not runtime behavior — enabling a disabled agent for real requires actually
  building it (see "Explicitly deferred" below).

Editing these files changes campaign options and scoring behavior on the next
seed/run — no code changes required.

## Link-in-bio analysis

For social-first industries, `packages/core/src/enrichment/linkClassifier.ts`
classifies every link on a prospect's Linktree/Beacons/Stan Store page into a
purpose (booking / payment / contact / social / review / menu / website) and,
where recognised, a named provider. This is **real logic, not a mock** — it works
against genuine URLs today; only the page *fetch* is mocked this phase
(`LinkInBioProvider`, whose real implementation reads Linktree's `__NEXT_DATA__`
JSON over plain HTTP).

It matters because it answers the qualification question directly: a GlossGenius
link means an incumbent is already in place, while payment links with **no**
booking link means the business is collecting deposits by hand and coordinating
in the DMs — the exact workflow an integrated booking product replaces. A
provider identified from a real link always overrides the pipeline's generic
guess. The platform registry is `config/link-signals.json`; adding a booking
platform is a config edit, not a code change.

## Prospect scoring

`packages/core/src/scoring/scoringEngine.ts` computes a 0–100 score per lead from the
factors in `config/scoring-config.json` (no website, poor website, no booking,
phone/social booking, multiple staff, strong reviews, etc. — each independently
point-weighted and toggleable). **Data confidence (HIGH/MEDIUM/LOW)** is computed
separately, from how many key research fields were actually resolved — it is never
mixed into the score itself. Every scoring pass appends a row to `score_results`
(audit trail); `leads` keeps the current score denormalized for fast reads.

## Where real research plugs in later

Three interfaces isolate "how we get information" from "what we do with it":

- `DiscoveryProvider` (`packages/core/src/providers/discoveryProvider.ts`) — finds
  candidate businesses (Scout). `MockDiscoveryProvider` today; a Places-API/search-based
  provider later, same interface.
- `EnrichmentProvider` (`packages/core/src/providers/enrichmentProvider.ts`) — researches
  a business in depth (Researcher). `MockEnrichmentProvider` today.
- `ReasoningProvider` (`packages/core/src/reasoning/reasoningProvider.ts`) — genuine LLM
  reasoning (narrative score explanations now; real website-quality judgment for the
  Website Analyst, and future sales-assistant features, later). `MockReasoningProvider`
  today.

Swapping any of these in `scripts/lib.ts` / `apps/dashboard/lib/data.ts` is the only
change needed — workers, scoring, the queue, and the dashboard are untouched.

## CRM — Pipedrive (built, dry-run)

`CrmAdapter` (`packages/core/src/crm/crmAdapter.ts`) models `pushLead` / `updateStage` /
`getRecords`. Two implementations exist: `MockCrmAdapter` (local table only) and
**`PipedriveCrmAdapter`** (`packages/core/src/crm/pipedriveAdapter.ts`), which is what the
pipeline is wired to today.

**It is safe by default.** The adapter has two modes and starts in the safe one:

| Mode | When | Behavior |
|---|---|---|
| `dry-run` | default | Builds the exact Pipedrive request payloads and records the hand-off locally. **Zero network calls.** |
| `live` | opt-in | Actually writes to the Pipedrive REST API. |

Live mode requires **two independent switches**: `PIPEDRIVE_API_TOKEN` must be set *and*
`PIPEDRIVE_LIVE_SYNC` must equal `1`. A token leaking into an environment is deliberately
not sufficient on its own to start writing to a real CRM, and `DEMO_READ_ONLY=1`
hard-disables live sync regardless of both. `describePipedriveMode()` reports which mode
is active and precisely why, so the dashboard can never misrepresent the connection state.

The payload builders (`buildOrganizationPayload` / `buildPersonPayload` /
`buildDealPayload` / `buildHandoff`) are **pure functions** exported independently of the
adapter — that's what lets the `/crm` page and every Lead Detail page show the real
outbound JSON with no credentials, no network stack, and no adapter instance.

**Mapping is config, not code** — `config/crm-pipedrive.json` holds the Lead→Pipedrive
field mapping, the custom-field keys, the deal pipeline, and the stage map. Anything left
`null` (a custom-field key, a stage id) is **skipped and reported**, never guessed, so a
half-configured account can't silently write records to the wrong stage. Connecting a real
account is a config-and-env change with no code edits: create the fields in Pipedrive, paste
their keys into that file, set the two env vars.

### Connecting a Pipedrive account

```bash
# 1. Get a token: Pipedrive -> your avatar (top right) -> Personal preferences -> API
PIPEDRIVE_API_TOKEN=xxx npm run setup-crm -- --dry-run   # see what it would do
PIPEDRIVE_API_TOKEN=xxx npm run setup-crm                # do it

# 2. Check it
PIPEDRIVE_API_TOKEN=xxx PIPEDRIVE_LIVE_SYNC=1 npm run test-crm

# 3. Only when you actually want leads written:
#    set PIPEDRIVE_LIVE_SYNC=1 in the environment
```

`setup-crm` verifies the token, creates the 14 custom fields this system
produces, reads back the 40-character keys Pipedrive assigns them, discovers
the deal pipeline and its stages, and writes all of it into
`config/crm-pipedrive.json`. Commit that file — the keys are account-specific
but not secret. The token is passed as a header, never in a URL.

It is **safe to re-run**: fields are matched by name, so a second run creates
nothing and just refreshes the keys. It only ever adds field *definitions* — it
never edits or deletes an existing field, and never touches organizations,
people, or deals.

Two things to check afterwards:

- **Stage mapping is positional.** The script maps this system's stages onto
  yours in order and prints exactly what it chose. Your pipeline's stages mean
  whatever you named them, so read that table and correct
  `deal.stageMap` if the guess is wrong. Anything left `null` is skipped, never
  guessed at.
- **Setup does not turn syncing on.** `setup-crm` needs only the token;
  actually writing leads needs `PIPEDRIVE_LIVE_SYNC=1` as well. Creating the
  schema and starting to push records are separate decisions.

**Syncing twice does not duplicate.** The ids Pipedrive assigns are stored on
the CRM record, and their presence turns a repeat sync into an update rather
than a second copy of every business — which matters because re-running a
campaign is the normal case here, not an edge case. The same stored deal id is
what a stage update actually addresses. `npm run test-crm` verifies credentials
with a single authenticated read and reports how much of the mapping is filled
in, without writing anything.

Requests retry with backoff on 429 and 5xx. Pipedrive enforces both a rolling
burst window and a daily token budget, so a busy campaign will hit 429 —
treating that as fatal would drop leads mid-sync. The token is sent as an
`x-api-token` header rather than a query parameter so it never lands in a URL,
where it would end up in logs.

Sync rules: an Organization for every pushed lead; a Person only when a phone or email
exists (many of the best-scoring leads are exactly the businesses with no contact details,
and those still get an Organization rather than being dropped); a Deal only for
`QUALIFIED`/`HIGH_PRIORITY`. No deal value is ever sent — this system does not model
revenue and will not invent a number.

This system is explicitly **not** meant to replace a CRM — it's the research/scoring layer
that feeds one, via `lead.pipelineStage`
(`RESEARCH -> QUALIFICATION -> CRM -> OUTREACH -> FOLLOW_UP -> SALE`).

## Work queue

Jobs are `city + industry + batch`, with statuses `pending | running | complete | failed |
retry | human_review | paused`. Each job carries a `payload` checkpoint so a resumed job
picks up where it left off rather than restarting. See `packages/core/src/queue/jobQueueManager.ts`.
A job that finds zero businesses, or exhausts its retries, creates a `human_review_items`
row rather than silently failing.

## Scaling later

- Adding a state/city/industry = adding config rows, not code.
- The repository layer (`packages/db`) implements interfaces defined in `packages/core`,
  and now runs on either SQLite or Postgres behind those same interfaces — see
  **Storage** below.
- `batchSize` on a campaign bounds job size; the DB-backed queue is designed so multiple
  worker processes could later claim jobs concurrently.

## The AI Manager

You talk to the Manager; it coordinates the team. There's a floating button in
the bottom-right of every dashboard page, and a dedicated **Manager** area with
Overview, Employees, Activity, Instructions, Reports, Scheduled and Memory.

### Where the competence actually lives

The Manager's abilities are eighteen typed **tools** (`packages/core/src/manager/tools.ts`).
Each one is ordinary code that really queries or changes the platform. None
returns invented data and none is a placeholder.

A language model, when one is configured, does exactly one job: choose which
tool to run and with what arguments. That separation is deliberate — it means
the Manager works with or without an API key, and a key improves *how requests
are understood*, never *what can be done*.

| Brain | Needs | Handles |
|---|---|---|
| `RuleBasedManagerBrain` | nothing | The request shapes the product is built around. Says plainly when it doesn't understand rather than guessing. |
| `ClaudeManagerBrain` | `ANTHROPIC_API_KEY` | Arbitrary phrasing, via real Anthropic tool-use. |

`selectBrain()` picks from the environment and the Manager page displays which
one answered, so you always know what you're talking to.

### Who writes the reply

The tool computes the facts; the brain may rephrase them. `ManagerBrain.narrate`
is optional — the rule-based brain omits it entirely, so with no key the tool's
own wording is what you read.

Two things are never rephrased, deliberately:

- **Approval prompts.** They have to state exactly what is about to happen, so a
  fluent paraphrase is a liability rather than an improvement.
- **Failures.** They have to name the actual error.

And a rewrite is discarded — falling back to the tool's wording — whenever it
can't be trusted: an API failure, an empty reply, or a digit that wasn't in the
source. `numbersAreGrounded()` enforces that last one. Dropping a figure is
fine; inventing one is not. A stiff sentence beats a fluent fabrication.

### Instructions: enforced or advisory, never pretend

An instruction either changes behaviour or is labelled advisory. There is no
third state where the system implies it did something and didn't.

Four effects are genuinely enforced:

| Effect | Employee | What it does |
|---|---|---|
| `exclude_name_patterns` | Scout | Drops candidates whose name matches — this is how "no chains" works |
| `restrict_cities` | Scout | Limits discovery to named territories |
| `score_adjust` | Qualifier | Adds/subtracts points when a real condition holds |
| `min_score_threshold` | Qualifier | Treats anything below as unqualified |

Anything else is stored, versioned, shown on the employee's page and quoted back
on request — but marked **Advisory** everywhere it appears.

Enforced score adjustments appear in the lead's breakdown as ordinary factors,
so the total always equals the sum of its visible parts.

**Permanent vs temporary.** "From now on" is permanent and stands until revoked
or superseded. "For today's search" is temporary and expires tonight, or when
its campaign ends. Ambiguous phrasing defaults to **temporary** on purpose: a
rule that quietly became permanent is much harder to notice than one that
quietly expired.

Contradictory permanent rules of the same kind supersede each other rather than
stacking, with full version history. Nothing is ever deleted.

### Safety

Read-only tools run immediately. Anything that changes behaviour or moves work
states what it intends to do and waits for you. Approvals and rejections are
both recorded with who decided and when.

### Memory

Six tables — conversations, messages, instructions, actions, reports, schedules.
Your message is written before anything else can fail, so a crash mid-turn still
leaves the request on the record. "What did I tell the Scout last week" is a
database query, not a model recalling.

### Voice

The browser's own Web Speech API: recognition in, synthesis out. No key, no
per-minute cost, no audio leaving the device. Recognition needs Chrome, Edge or
Safari; in Firefox the microphone is visibly unavailable and the panel works as
text chat rather than showing a button that does nothing.

The microphone opens only when you click it and closes after one utterance.
There is no always-listening mode and no wake word. `startListening` is the
single entry point, so adding an opt-in wake word later means calling it from a
detector, not loosening anything.

### Scheduling

"Every morning at 9" becomes a row in `scheduled_tasks`, not a promise.
`/api/cron/run-scheduled` runs what's due and archives the result. It requires
`CRON_SECRET` and refuses outright when unset. Times are UTC — see
NEEDS_OWNER_INPUT.md.

### Testing

`npm run test-manager` — 138 assertions against a real database. The instruction
tests check *consequences*: a campaign runs with chain-exclusion active and no
chain-named business reaches the leads table; the rule is revoked, a second
campaign runs, and chains reappear — proving the filter did the work rather than
the generator never producing one.

## Storage

One switch decides the backend, and it is just an environment variable:

| `DATABASE_URL` | `DEMO_READ_ONLY` | Backend |
|---|---|---|
| set | — | **Postgres.** Persistent and writable. What a real deployment uses. |
| unset | `1` | SQLite snapshot opened read-only — the public demo. Nothing written persists. |
| unset | unset | Local SQLite file (`data/prospecting.db`). Development. |

`describeBackend()` in `packages/db/src/index.ts` is the single place that decides, and the
Settings page displays the result, so which backend is live is never a guess.

### Why one repository implementation, not two

`packages/db/src/sqlClient.ts` is a thin shim over both drivers. It exposes the same
`prepare(...).get/all/run` shape better-sqlite3 uses, and for Postgres rewrites
better-sqlite3's parameter styles (`@name` and `?`) into Postgres positional placeholders
(`$1`, `$2`), skipping anything inside single-quoted string literals.

The point is that the repositories are written **once**. The same SQL and the same
row-mapping code serve both backends, so the two cannot quietly disagree about how a null
is stored or how an upsert resolves. Two hand-written repository sets would have been twice
the code and twice the places to drift.

Everything on the repository interfaces is `async` for this reason: better-sqlite3 is
synchronous and simply resolves immediately, while Postgres genuinely goes over the wire.

### Schema

`supabase/migrations/` holds the Postgres schema as applied, in order.
`packages/db/src/schema.sql` is the SQLite equivalent — the two are kept deliberately
parallel. JSON-ish columns are `TEXT` on both sides rather than `JSONB`, so both adapters
`JSON.parse`/`stringify` at the same edge.

The Supabase project used here is a **separate project from the booking platform's** —
never that one. Row Level Security is enabled on every table with **no policies**, which
denies every PostgREST request; the app's own server-side connection bypasses RLS. Without
that, the publishable anon key could read `users` password hashes and live reset tokens.

### Connecting it

Set `DATABASE_URL` to the Supabase connection string (Project Settings → Database →
Connection string → **Transaction pooler**, with your database password substituted in) as
a Vercel environment variable. Nothing else changes: same image, same code.

## Dashboard

`apps/dashboard` (Next.js App Router, server components + server actions, no client-side
state management beyond a small polling component and the sidebar's active-link
highlighting). Nav: **Overview, Team, Campaigns, Leads, Analytics, Settings**, plus
visibly-disabled **CRM** and **Outreach** entries. Work Queue and High Priority remain
routes (linked from Campaigns' "view jobs" and Leads/Overview respectively) rather than
top-level nav items.

- **Overview** — AI Team Status + Active Campaigns at a glance.
- **Team** — agent card grid; each agent's detail page shows role, current assignment,
  live status, progress, recent activity, results, errors, and (where applicable) a
  direct natural-language command box.
- **Campaigns** — Manager Command Box ("Assign Task") plus the existing manual form and
  per-campaign start/pause/resume/stop controls and job list.
- **Leads** — filterable/searchable table with a per-lead pipeline-stage checklist column
  and a **Download CSV** button; Lead Detail shows the full field set, score breakdown,
  agent activity, and explicit "FUTURE CRM STATUS: DISABLED" / "FUTURE OUTREACH STATUS:
  DISABLED" panels.
- **Analytics** — score/website/booking/confidence distributions and per-agent
  throughput. Deliberately no fake sales/revenue numbers — this system doesn't sell
  anything yet.
- **Settings** — read-only view of scoring weights, qualification/confidence thresholds,
  territories, industries, and the agent roster, all sourced from `config/*.json`.

All mutations (campaign controls, job requeue, task assignment) are server actions that
only touch the local SQLite file — see `apps/dashboard/lib/actions.ts`. Pages that
benefit from feeling "alive" (Overview, Team, Campaigns) poll `router.refresh()` every
few seconds via `LiveRefresh.tsx` — no websockets, since this is a low-frequency
single-process internal tool.

## Real businesses — the Overture import

Discovery is the [Overture Maps](https://docs.overturemaps.org/) open places
dataset: ~61M businesses worldwide, published as GeoParquet on public S3 under
CDLA Permissive v2.0. Free, commercial use allowed, and — unlike Google Places —
**we are permitted to keep what we read**, which matters when the product is a
lead database you review in a spreadsheet.

Florida alone is **77,325 businesses across 714 towns and cities**: 95% carry a
phone number, 72% a social profile, and **21,577 have no website at all**.

Two halves, deliberately separate:

- `scripts/fetch-overture.py` — extraction. Reads remote parquet over HTTP range
  requests rather than downloading 10GB: the files are spatially sorted with
  per-row-group bounding boxes, so a state-sized box touches about a fifth of
  them. Florida took 73 seconds. Emits NDJSON and knows nothing about leads.
- `packages/core/src/providers/overturePlaces.ts` + `scripts/import-overture.ts`
  — mapping, scoring and storage. Testable against a fixture with no network.

`config/overture-categories.json` maps Overture's categories onto our
industries, and is read by both halves so they cannot disagree about what a
barber is.

### What the importer refuses to invent

Overture knows whether a business has a website. It does not know whether that
site takes bookings, how many staff work there, or whether anyone still posts to
the Instagram account. `OnlineBookingStatus` and `BookingMethod` therefore carry
an `UNKNOWN` member, which is **not** a rounding of `NONE` — it means nobody has
looked. Scoring an unchecked business as "no online booking" would award 16
points for a finding that was never made.

The visible consequence is that **nothing reaches Qualified on discovery data
alone**, because the largest factor in the score has not been checked. That is
correct, not broken. What is actionable today is the no-website cohort.

### Refreshing

Re-importing is an update, not a duplicate: leads carry the source's own id in
`external_id`, and the bulk upsert conflicts on it. That means the database
resolves a refresh without the importer first reading every existing lead —
which is what keeps the last chunk of a state as cheap as the first.

### Running it from the dashboard

`/import` runs the whole thing from a browser. The extract ships gzipped in the
repo and `/api/admin/import` imports it in resumable chunks, because no
serverless invocation finishes 77,000 rows and a stopped import should lose
nothing. Closing the tab is safe; starting again carries on.

### Organisation, at national scale

State is the unit you expand by, industry the unit you sell to, and **city and
ZIP are filters on the lead, not the filing system**. A campaign per city does
not survive 714 of them in one state, so campaigns are per (state, industry) —
"Florida — Barbers" — and `Territory` carries a `scope` so calling a state a
"city" is no longer a quiet lie. ZIP is deliberately a filter rather than the
spine: ZIPs are postal routes, they do not nest inside cities, and there are
about 41,000 of them.

## Website analysis — the Website Analyst

The largest single factor in the score is whether a business already takes
bookings online. Overture cannot answer that, so the answer comes from reading
their own website.

- `packages/core/src/enrichment/siteFetcher.ts` — the fetch. Identifies itself,
  gives up after 8s, caps the read at 600KB, and refuses anything that is not a
  public http(s) URL. The URLs come from a third-party dataset, so a server-side
  fetcher that would follow `file://` or dial a private address is a
  server-side request forgery waiting to happen.
- `packages/core/src/enrichment/websiteAnalyzer.ts` — the judgement. Pure, so it
  is testable against canned pages. Every conclusion traces to something
  literally in the HTML: a link to a known booking platform, a "Book Now"
  anchor, a viewport tag, a stale copyright year. Where the evidence runs out
  the answer stays UNKNOWN.
- `packages/core/src/workers/websiteCheckWorker.ts` — fetch, analyse, re-score,
  with bounded concurrency and a wall-clock deadline rather than a guessed
  batch size.
- `apps/dashboard/app/api/cron/check-websites/route.ts` — drains the queue,
  best prospects first, every 10 minutes. `CRON_SECRET` required; it refuses to
  run without one.

Three deliberate refusals:

1. **An unreachable site asserts nothing.** A dead domain is not evidence of no
   online booking — they might still be on Booksy. The lead is stamped as
   checked so it leaves the queue, but booking stays UNKNOWN.
2. **A "Book Now" link to their own site counts as online booking.** No provider
   is named, and the evidence says to go and look. Scoring an in-house booking
   page as NONE would be wrong in the most expensive direction.
3. **Businesses with no website are not analysed at all.** They are 23,941 of
   the best-looking leads and marking them "no online booking" would light the
   whole cohort up — but a salon with no website can still be on Booksy, which
   makes them a worse prospect, not a better one. Resolving them needs the
   booking platforms' own directories, which is separate work.

### Data confidence: NONE counts, UNKNOWN does not

`NONE` and `UNKNOWN` were once treated alike, which was defensible while NONE
doubled as the unresearched default. Now that UNKNOWN carries "nobody looked",
NONE means the opposite — somebody looked and the answer is none — so it raises
data confidence. Without that, reading a prospect's website could never make
them better understood, which is precisely backwards.

## Spreadsheet export

Nothing has to be "connected" to Excel. The **Download CSV** button on **Leads** and
**High Priority** produces a file that Excel, Numbers and Google Sheets all open by
double-clicking.

- The download honours whatever filters are on screen, including the High-Priority saved
  views — filter first, then download, and the file matches the table above it. The saved
  views live in `packages/core/src/leadPresets.ts` so the page and the export cannot
  disagree about what "poor website + no booking" means.
- One row per lead, 38 columns: identity, score and the reason for it, location, contact
  details, website/booking findings, social, the services list, and the campaign and lead
  ids so a row can be traced back into the app.
- Route: `apps/dashboard/app/api/export/leads.csv/route.ts`. It is behind the same session
  check as every other page — the only self-authenticating exception in `middleware.ts` is
  `/api/cron/*`.
- Writer: `packages/core/src/export/leadsCsv.ts`. It emits a UTF-8 BOM (Excel misreads
  accented characters without one) and neutralises leading `=`, `+`, `-` and `@` so a
  business name can never execute as a spreadsheet formula. `npm run test-export` covers
  the escaping, the formula guard, and a round-trip parse (37 assertions).

## Authentication

The dashboard sits behind a login. There are three possible postures, decided
entirely by environment variables:

| `SESSION_SECRET` | `DEMO_READ_ONLY` | `DATABASE_URL` | Result |
|---|---|---|---|
| set | either | either | **Login required** on every route |
| not set | `1` | not set | Public read-only demo of synthetic data |
| not set | `1` | set | **Refuses to serve** (HTTP 503) |
| not set | not set | either | **Refuses to serve** (HTTP 503) |

Failing closed is deliberate: a real deployment holding real prospect data
refuses rather than quietly exposing it. The only way to serve anything without
a login is to explicitly mark the deployment as the fake-data demo.

`DATABASE_URL` cancels that demo exemption on purpose. The exemption is only
safe because the demo's data is a read-only synthetic snapshot — a Postgres
connection is neither read-only nor synthetic. Without this rule, adding
`DATABASE_URL` to the existing demo deployment (the natural first step when
going live) would publish a **writable** database to anyone with the URL.

**Set the auth variables before, or at the same time as, `DATABASE_URL`.**

`DATABASE_URL` also cancels demo mode itself (`lib/demo.ts`), for the same
reason. Demo mode disables every control in the dashboard, because the SQLite
snapshot cannot be written to. With Postgres attached that reason is gone, and
a leftover `DEMO_READ_ONLY=1` would otherwise leave every button looking live
while silently doing nothing. It does not relax the CRM switches — live sync
still needs a token *and* `PIPEDRIVE_LIVE_SYNC=1`.

### Turning it on (auth)

```bash
npm run create-user -- you@example.com 'a long passphrase you choose'
```

That writes the user to the local database *and* prints the three environment
variables to set on the deployment:

```
SESSION_SECRET=…        # signs session cookies; rotating it signs everyone out
ADMIN_EMAIL=…
ADMIN_PASSWORD_HASH=…   # scrypt hash — the password itself is never stored
```

`ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` exist because the deployed database may be
opened **read-only**, leaving nowhere to write a users row. Env credentials plus
a stateless signed cookie mean sign-in works anyway. Once there's a writable
database, users in the `users` table work the same way — and both are checked,
so either one alone is enough to get in.

`ADMIN_PASSWORD` is a plaintext alternative to `ADMIN_PASSWORD_HASH`. The hash
is safer, because an environment variable that leaks then reveals a hash rather
than a reusable password. Set the plaintext one only when pasting an unbroken
178-character line into a hosting dashboard is the step that keeps going wrong —
a clipped or wrapped paste reads as *"password is incorrect"*, which sends you
hunting the wrong problem. If both are set, the hash is tried first.

**Two failure modes worth knowing before you debug a login:**

- **No second way in.** Login checks the env admin *and* the `users` table, and
  a failure on the first no longer stops the second. It used to, which meant one
  mistyped variable locked the owner out of a perfectly healthy database. If you
  care about the account, keep both a `users` row and the env vars.
- **Vercel bakes environment variables at build time**, and scopes them per
  environment. After changing one, tick **Production** and **redeploy** — until
  you do, the running deployment still holds the old value.

A malformed `ADMIN_PASSWORD_HASH` now reports itself as a misconfiguration on
the login page instead of as a wrong password. The message names the variable
and what is wrong with its shape, never any part of its value, and it is shown
for any submitted address so it cannot be used to discover which one is the
admin.

### How it's built

- **Passwords**: scrypt (`node:crypto`), random per-password salt, constant-time
  comparison, parameters stored in the hash so they can be raised later without
  invalidating existing hashes. No third-party dependency.
- **Sessions**: an HMAC-SHA256-signed cookie — `httpOnly`, `sameSite=lax`,
  `secure` in production, 12-hour expiry. Signed with **Web Crypto**, not
  `node:crypto`, because Next.js middleware runs on the Edge runtime; that's
  also why `packages/core` exposes `@market-outreach/core/auth/session` as a
  subpath export, so middleware never pulls in the `node:fs`-dependent barrel.
  Stateless sessions can't be revoked individually before expiry — rotating
  `SESSION_SECRET` invalidates all of them, which is the right lever at this
  size.
- **Route protection**: `middleware.ts` protects everything by default; the
  exceptions are the short explicit list in `lib/authConfig.ts`. A new page
  cannot accidentally ship unprotected.
- **Password reset**: single-use tokens, 30-minute expiry, only the SHA-256
  **hash** is stored so a leaked database doesn't allow resets. Using a token
  invalidates every other outstanding link for that account.
- **No account enumeration**: login failures are always the same message, and
  "forgot password" always reports success whether or not the address exists.
- **Rate limiting**: an in-memory per-instance throttle on login and reset
  attempts. It slows casual guessing but resets on cold start — a shared-store
  limiter belongs here once there's a database to put it in.

**The gap**: no email provider is connected, so a reset link is shown to the
operator rather than sent. That must become a real email before anyone other
than the owner uses this.

## Public demo

A public, **read-only** deployment runs on Vercel with `DEMO_READ_ONLY=1`: every mutating
control (Assign Task, campaign start/pause/stop, job requeue) is disabled in the UI. The
demo database is `data/demo.db`, embedded as a base64 string in
`packages/db/src/demoDbData.ts` (Vercel's output-file-tracing did not reliably include the
raw `.db` file even when explicitly declared, so it's shipped as part of the actual JS
module graph instead). To update the public demo after a schema or seed-data change:

```bash
npm run reset-db && npm run seed && npm run run-campaign   # regenerate data/demo.db
node scripts/encode-demo-db.mjs                             # regenerate demoDbData.ts
```

then commit both files.

## Known dev-dependency advisory

`npm audit` flags transitive `postcss`/`sharp` advisories inherited from Next.js 15 (fixed
upstream in Next 16, a breaking change deferred for this skeleton phase). Neither package
is exercised by this app — no `next/image`, no user-supplied CSS/images — so this does
not represent a live risk here, but should be revisited (`npm audit fix --force` or an
upgrade to Next 16) before any production/multi-user deployment.

## Explicitly deferred to a later phase

Real Discovery/Enrichment providers (Places API, scraping, LLM research), real
website/booking analysis (actually reading a site via a live `ReasoningProvider` call), a
live LLM-backed command parser, a real CRM connector, Resend/Twilio outreach, a CRM agent,
an Outreach agent, call transcription and sales-assistant features (objection/buying-signal
extraction, meeting briefings/debriefs, geographic trip clustering, onboarding
automation), and production hosting.
