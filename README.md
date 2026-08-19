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

- No live business discovery, web search, or scraping.
- No real leads — every business in this system is synthetically generated.
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
- The repository layer (`packages/db`) implements interfaces defined in `packages/core` —
  swapping SQLite for Postgres/a dedicated Supabase project (never the booking platform's
  production project) is a config change behind the same interfaces.
- `batchSize` on a campaign bounds job size; the DB-backed queue is designed so multiple
  worker processes could later claim jobs concurrently.

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
- **Leads** — filterable/searchable table with a per-lead pipeline-stage checklist column;
  Lead Detail shows the full field set, score breakdown, agent activity, and explicit
  "FUTURE CRM STATUS: DISABLED" / "FUTURE OUTREACH STATUS: DISABLED" panels.
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
automation), auth/multi-user permissions, production hosting, and any Postgres/Supabase
migration.
