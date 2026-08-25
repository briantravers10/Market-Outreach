# Making the score worth trusting

Banked 25 Aug 2026, to pick up cold.

## The goal, in the owner's words

> "I want to max out the capabilities of scoring these leads, this is the single
> most important thing that will save me time so I don't have to double check
> your work."

That last clause is the actual specification, and it is stricter than "more
signal". A score that is 80% accurate still has to be checked, so it saves
nobody any time — the checking *is* the work. What earns trust is not a better
number but a number that arrives with its evidence attached, and an honest line
between what was verified and what was inferred.

So every item below has to satisfy two things, not one:

1. It makes the score more accurate.
2. It makes the score **auditable in ten seconds** — the reason is on the lead,
   in words, traceable to something a human can go and look at.

Where those conflict, the second wins. A confident guess is worse than an
admitted gap, because a gap can be skimmed past and a wrong confident answer
costs a phone call to a business that already has an incumbent.

## Baseline, as of tonight

Measure tomorrow's work against these. Sweep still running.

| | |
|---|---|
| Leads | 77,325 |
| Websites read | 4,808 |
| Still queued | 48,576 |
| Unreachable (36%) | 1,706 |
| Confirmed no online booking | 1,824 |
| Qualified or better | 1,086 |
| Average score | 33 |
| Top score | 73 |

## The audit: seven of sixteen scoring factors have never fired

Measured across all 77,325 leads, not estimated.

| Factor | Worth | Blocked by | Coverage |
|---|---|---|---|
| `multiple-staff` | +10 | `staff_count` | **0 leads** |
| `strong-reviews` | +8 | `rating`, `review_count` | **0 leads** |
| `active-social-presence` | +8 | `social_activity` | **0 leads** |
| `established-business` | +6 | `location_count` | **0 leads** |
| `inactive-business` | −25 | `social_activity` | **0 leads** |
| `excellent-website` | −12 | our own bug — see below | **0 leads** |
| `poor-fit-industry` | −15 | nothing sets the flag | **0 leads** |

`insufficient-data` (−10) has fired **75,822 times — on 98% of leads** — and it
fires *because* those same fields are empty. Filling them is therefore a double
win: it adds the missing positives and removes a near-universal penalty. Until
then the score is compressed into a narrow band, which is exactly the condition
that makes a ranked list untrustworthy.

**A bug of ours, not a data gap:** `assessQuality` in
`packages/core/src/enrichment/websiteAnalyzer.ts` can only ever return POOR,
AVERAGE, GOOD or UNKNOWN. The scoring config has an `excellent-website` factor
for a value the analyzer cannot produce. Either teach the analyzer to recognise
an excellent site or delete the factor — but not both, and not neither.

## Two accuracy problems that matter more than the coverage gaps

**We only read the homepage.** Many salons put "Book" on an inner page. Some
share of the 1,824 leads currently marked "no online booking" are wrong, and
that is the single highest-weighted field in the model. A false positive here
sends the owner to a business that already has an incumbent — precisely the
call that destroys trust in the list.

**36% of sites did not respond**, with no retry, no `www`/`http` fallback, and
no second attempt on another day. Some are genuinely dead domains; some are
transient. Currently indistinguishable, and both are recorded as "checked".

## The plan, in order

Items 1–5 cost nothing. Do them before spending anything.

1. **Follow inner pages** — `/book`, `/services`, `/team`, `/contact`, plus any
   same-host link whose text matches the booking vocabulary. Fixes the false
   "no booking", and picks up staff counts, emails and service menus on the way.
   Biggest single accuracy gain available.
2. **Retry the unreachable** — `www`/non-`www`, `https`/`http`, and one retry on
   a later day. Distinguish "dead domain" from "was down when we looked", which
   are different sales conversations. A business whose website no longer loads
   is arguably a strong prospect; one we simply failed to reach is not a finding
   at all.
3. **Extract Overture's `brand` field** — never pulled it. Gives real chain and
   multi-location detection instead of the current name-matching heuristic, and
   unlocks `established-business`. Trivial: one column in
   `scripts/fetch-overture.py`.
4. **Staff count from team pages** — count the stylist cards on `/team`.
   Unlocks `multiple-staff` (+10). Imperfect, so it must record what it counted
   and where, and stay UNKNOWN when the page is ambiguous.
5. **Link-in-bio** — `config/link-signals.json` and the whole classifier already
   exist and **nothing populates `linkInBioUrl` for real leads**. Follow the
   link when a site or social profile points at a Linktree-style page.

6. **Instagram `business_discovery`** — free, but gated on the owner's
   Instagram Business account plus Meta app review, and the review is the slow
   part. Unlocks `social_activity` for the 72% who have socials. Start the
   account early even if the code comes later.

**Paid, and only worth it after the above:**

- **Google Places** for `rating` and `review_count` — roughly free at this
  volume, ~$2 per 1,000 beyond. Unlocks `strong-reviews`. The caching
  restriction still applies: their terms do not permit warehousing ratings, so
  this needs a design where the rating informs a stored judgement rather than
  being stored itself — and that reading needs checking by someone qualified.
- **An LLM pass on genuinely ambiguous pages** — ~$5 per 1,000. Only for the
  cases the deterministic rules cannot call, never as the default path. The
  rules are auditable; a model's opinion is not, which is the wrong trade for
  the trust requirement above.

## The Researcher agent

The owner has explicitly authorised adding one. The natural shape is a
per-lead deep pass that runs *after* the cheap sweep and only on leads that
matter — say, everything scoring above the qualification line — because it is
slower and, if it ever uses a model, not free.

Its job is the work items 1, 2, 4 and 5 describe, plus assembling the
call-ready summary: who they are, what they use today, what is wrong with it,
and the one sentence that opens the conversation. Every claim carries its
source.

That is a different job from the Website Analyst, which is a fast, shallow,
whole-database sweep. Keep them separate: one is breadth, one is depth, and
merging them would make the sweep too slow to ever finish.

## Open questions for the owner

- **`poor-fit-industry` (−15)** is a manual flag nothing sets. Is it wanted at
  all? If so, which trades?
- **Qualification thresholds** (60 / 80) were set against invented data. Once
  the factors above are live they should be re-set against real distribution —
  and ideally against the outcome of the owner's first hundred calls, which is
  the only thing that can actually calibrate them.
- **`beauty-salons` and `day-spas`** were added as separate industries because
  Overture has 15,464 and 10,593 of them. Merge into hair salons, or keep?
