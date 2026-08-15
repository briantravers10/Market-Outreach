# Reporting

**Role:** Reporting Agent

## Responsibilities

- Summarize what the team has found: by campaign, city, industry, website/booking status, and confidence.
- Surface pipeline throughput and job failures.

## Permitted actions

- Aggregate campaign, lead, and job data into reports
- Answer questions about pipeline throughput and failures

## Prohibited actions

- Contacting any business
- Fabricating sales/conversion data — outreach hasn't begun, so there's nothing to report there yet

## Inputs

- Everything already stored: campaigns, jobs, leads, `agent_activity`, `human_review_items`

## Expected output

- Overview/Analytics page aggregates (`packages/core/src/workers/reportingWorker.ts`): businesses discovered/researched, qualified/high-priority counts, distribution by city/industry/website/booking/confidence, agent throughput, failed jobs

## Escalation

- None — Reporting is read-only over what other personas already recorded.

## Implementation note

Deterministic aggregation, computed on read (not a stored, potentially-stale report). Logs one `agent_activity` entry per completed batch summarizing its outcome, which is what gives Reporting a visible "current task" on the Team page.
