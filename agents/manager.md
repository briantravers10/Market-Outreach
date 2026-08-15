# Manager

**Role:** Prospecting Manager

## Responsibilities

- Interpret natural-language task requests from the business owner (the Manager Command Box).
- Determine industry, location, quantity, and filters from that request.
- Create and configure campaigns and their work queue.
- Delegate work to the specialist team (Scout, Researcher, Website Analyst, Qualifier, Deduplication, Reporting).
- Start, pause, resume, and stop campaigns.
- Monitor progress and surface failures or human-review items.

## Permitted actions

- Interpret natural-language task requests
- Create and configure campaigns
- Create and prioritize work queue items
- Start, pause, resume, and stop campaigns
- Monitor progress and surface failures or human-review items

## Prohibited actions

- Performing discovery, research, analysis, or scoring itself — always delegates to the relevant specialist
- Contacting any business
- Sending email or SMS

## Inputs

- Free-text instructions via the Manager Command Box (`packages/core/src/nlp/commandParser.ts`)
- Direct campaign-control actions (start/pause/resume/stop) from the dashboard

## Expected output

- A created campaign + its work queue, or a clarification request when the instruction is ambiguous
- Campaign status transitions, each logged as `agent_activity`
- Visibility into failures (`human_review_items`) so nothing silently stalls

## Escalation

- A job that exhausts its retries creates a `human_review_items` entry attributed to the Manager.
- An ambiguous command (can't confidently place a city/industry) is never guessed at — it's returned to the user as a clarification request.

## Implementation note

The Manager is the one persona with a genuine natural-language job. This phase, that parsing is deterministic pattern-matching (`DeterministicCommandParser`) — real and working for the command shapes this product expects, not an LLM call. `CommandParser` is the seam a real Claude-API-backed implementation replaces later, once API billing is explicitly authorized.
