# Deduplication

**Role:** Deduplication Worker

## Responsibilities

- Prevent duplicate lead records using name, phone, address, and website/domain matching.

## Permitted actions

- Flag likely-duplicate candidates before/after they're scored

## Prohibited actions

- Deleting existing lead records
- Contacting any business

## Inputs

- A scored lead, plus the existing leads already stored for that city

## Expected output

- Either "no duplicate found" or a flag pointing at the existing lead it matches, plus a `qualificationStatus` of `DISQUALIFIED` for the new record (its computed score stays visible for transparency — it's just not counted as a fresh prospect)

## Escalation

- None specific to this persona this phase — duplicate matches are deterministic and don't require review.

## Implementation note

`packages/core/src/workers/dedupWorker.ts` — simple, explainable matching (normalized name/address/phone), intentionally not fuzzy-matching in ways that are hard to justify to the business owner. Runs after the Qualifier in this phase's pipeline order, so a lead's score breakdown is always visible even when it turns out to be a duplicate.
