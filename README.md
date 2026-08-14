# Market Outreach — AI Prospecting System (Skeleton Phase)

This repo is the **architecture skeleton** for an AI-powered prospecting system that will
eventually find, research, score, and hand off local-service-business leads for an
appointment-booking SaaS platform. **This phase runs on fake/test data only.**

## What this is NOT

- No live business discovery, web search, or scraping.
- No real leads — every business in this system is synthetically generated.
- No outreach. `packages/core/src/outreach/outreachService.ts` never sends email or SMS —
  every attempt is logged with `status: "DISABLED"`. Resend/Twilio are not installed as
  dependencies anywhere in this repo.
- No CRM connection. `mock_crm_records` previews what a future CRM hand-off would look
  like; it is a local SQLite table, not an integration.
- Fully isolated from the booking-platform product: separate repo, separate local SQLite
  database, no production credentials of any kind.

## Pipeline

```
DISCOVER -> ENRICH -> ANALYZE (website/booking) -> QUALIFY (score) -> DEDUP -> STORE -> REPORT
```

Implemented in `packages/core/src/prospectingManager.ts`, driven per **job** (a
city + industry + batch unit of work). Deterministic code handles orchestration, scoring,
dedup, and reporting; a small set of provider interfaces are where real intelligence
(discovery, enrichment, reasoning) will plug in later without changing pipeline code.

## Project structure

```
config/                   Editable JSON: territories, industries, scoring weights
packages/
  core/                    Domain types, workers, scoring engine, queue manager,
                           orchestrator (ProspectingManager), provider interfaces
  db/                      SQLite schema + repository implementations of core's ports
apps/
  dashboard/               Next.js internal dashboard (App Router)
scripts/
  seed.ts                  Populates fake campaigns/jobs/leads across all territories x industries
  run-campaign.ts          Drains pending jobs for running campaigns, prints a report
  reset-db.ts              Deletes the local SQLite file
data/                      Local SQLite file lives here (gitignored)
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
- `config/industries.json` — target industries (currently 10 examples; product is not
  industry-specific, so this list is meant to grow)
- `config/scoring-config.json` — prospect-score point weights, thresholds for
  HIGH/MEDIUM/LOW data confidence, and QUALIFIED/HIGH_PRIORITY/DISQUALIFIED cutoffs

Editing these files changes campaign options and scoring behavior on the next
seed/run — no code changes required.

## Prospect scoring

`packages/core/src/scoring/scoringEngine.ts` computes a 0–100 score per lead from the
factors in `config/scoring-config.json` (no website, poor website, no booking,
phone/social booking, multiple staff, strong reviews, etc. — each independently
point-weighted and toggleable). **Data confidence (HIGH/MEDIUM/LOW)** is computed
separately, from how many key research fields were actually resolved — it is never
mixed into the score itself.

## Where real research plugs in later

Three interfaces isolate "how we get information" from "what we do with it":

- `DiscoveryProvider` (`packages/core/src/providers/discoveryProvider.ts`) — finds
  candidate businesses. `MockDiscoveryProvider` today; a Places-API/search-based
  provider later, same interface.
- `EnrichmentProvider` (`packages/core/src/providers/enrichmentProvider.ts`) — researches
  a business in depth. `MockEnrichmentProvider` today.
- `ReasoningProvider` (`packages/core/src/reasoning/reasoningProvider.ts`) — genuine LLM
  reasoning (narrative score explanations now; real website/content judgment and future
  sales-assistant features later). `MockReasoningProvider` today.

Swapping any of these in `scripts/lib.ts` / `apps/dashboard/lib/data.ts` is the only
change needed — workers, scoring, the queue, and the dashboard are untouched.

## Where a real CRM plugs in later

`CrmAdapter` (`packages/core/src/crm/crmAdapter.ts`) models `pushLead` /
`updateStage` / `getRecords`. `MockCrmAdapter` writes to a local `mock_crm_records`
table today (visible on each lead's detail page as a "Future CRM Preview"). A real
HubSpot/GoHighLevel/Salesforce adapter implements the same interface later. This system
is explicitly **not** meant to replace a CRM — it's the research/scoring layer that feeds
one, via `lead.pipelineStage` (`RESEARCH -> QUALIFICATION -> CRM -> OUTREACH -> FOLLOW_UP -> SALE`).

## Work queue

Jobs are `city + industry + batch`, with statuses `pending | running | complete | failed |
retry | human_review | paused`. Each job carries a `payload` checkpoint so a resumed job
picks up where it left off rather than restarting. See `packages/core/src/queue/jobQueueManager.ts`.

## Scaling later

- Adding a state/city/industry = adding config rows, not code.
- The repository layer (`packages/db`) implements interfaces defined in `packages/core` —
  swapping SQLite for Postgres/a dedicated Supabase project (never the booking platform's
  production project) is a config change behind the same interfaces.
- `batchSize` on a campaign bounds job size; the DB-backed queue is designed so multiple
  worker processes could later claim jobs concurrently.

## Dashboard

`apps/dashboard` (Next.js App Router, server components + server actions, no client-side
state management). Pages: Overview, Work Queue, Campaigns (with start/pause/resume/stop
controls), Leads (filterable), Lead Detail (full field set + score breakdown), High
Priority (80+, with compound filter presets), Reports.

All mutations (campaign controls, job requeue) are server actions that only touch the
local SQLite file — see `apps/dashboard/lib/actions.ts`.

## Known dev-dependency advisory

`npm audit` flags transitive `postcss`/`sharp` advisories inherited from Next.js 15 (fixed
upstream in Next 16, a breaking change deferred for this skeleton phase). Neither package
is exercised by this app — no `next/image`, no user-supplied CSS/images — so this does
not represent a live risk here, but should be revisited (`npm audit fix --force` or an
upgrade to Next 16) before any production/multi-user deployment.

## Explicitly deferred to a later phase

Real Discovery/Enrichment providers (Places API, scraping, LLM research), real
website/booking analysis (actually reading a site), a real CRM connector, Resend/Twilio
outreach, call transcription and sales-assistant features (objection/buying-signal
extraction, meeting briefings/debriefs, geographic trip clustering, onboarding
automation), auth/multi-user permissions, production hosting, and any Postgres/Supabase
migration.
