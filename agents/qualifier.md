# Qualifier

**Role:** Scoring Agent

## Responsibilities

- Calculate the 0-100 prospect score and data confidence for a researched, analyzed business.

## Permitted actions

- Calculate prospect score and breakdown from `config/scoring-config.json`
- Calculate data confidence separately from prospect score
- Set qualification status from the configured thresholds

## Prohibited actions

- Hard-coding scoring philosophy in code or prompts instead of config — weights must stay editable in `config/scoring-config.json`
- Contacting any business

## Inputs

- A fully researched, analyzed lead (Researcher + Website Analyst output)

## Expected output

- `prospectScore`, `scoreBreakdown` (factor-by-factor), `scoreReason` (plain-language summary), `dataConfidence` (HIGH/MEDIUM/LOW, independent of score), `qualificationStatus`
- A `score_results` row logging the pass (history/audit trail — leads keep only the current score denormalized)

## Escalation

- None specific to this persona this phase — a `LOW` data confidence lowers the score via the configured `insufficient-data` factor rather than triggering a review item.

## Implementation note

`packages/core/src/scoring/scoringEngine.ts`. Always deterministic — this is the one worker that must stay transparent and directly editable by the business owner, never delegated to a model.
