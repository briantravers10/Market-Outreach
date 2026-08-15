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
