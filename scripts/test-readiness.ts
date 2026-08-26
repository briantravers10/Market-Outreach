/**
 * The gate between the holding area and the working list.
 *
 * The requirement, in the owner's words: "I don't want to be wasting my time
 * ringing leads that I don't need to." So the property under test is not
 * "readiness is computed correctly" but the stricter one — a lead nobody has
 * finished researching must never be classed ready, whatever else is true
 * about it.
 *
 *   npm run test-readiness
 */
import { ANALYSIS_VERSION, assessReadiness, describeHoldReason, type Lead } from "@market-outreach/core";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

type Subject = Pick<Lead, "onlineBookingStatus" | "analysisVersion" | "websiteCheckedAt" | "isDuplicateOf" | "website">;

/** A lead that has been fully researched by the current method. */
function ready(overrides: Partial<Subject> = {}): Subject {
  return {
    website: "https://salon.example/",
    websiteCheckedAt: "2026-08-26T12:00:00.000Z",
    onlineBookingStatus: "NONE",
    analysisVersion: ANALYSIS_VERSION,
    isDuplicateOf: null,
    ...overrides,
  };
}

function main(): void {
  section("Ready means finished");

  check("a fully researched lead is ready", assessReadiness(ready()).ready);
  check("a ready lead has no hold reason", assessReadiness(ready()).reason === null);
  check(
    "a lead found to have booking is also ready",
    assessReadiness(ready({ onlineBookingStatus: "THIRD_PARTY_BOOKING_SYSTEM" })).ready
  );

  section("Anything unfinished is held back");

  {
    const r = assessReadiness(ready({ websiteCheckedAt: null }));
    check("a site nobody has read is held", !r.ready);
    check("and the reason says so", r.reason === "never-researched", String(r.reason));
  }

  {
    // The 19,390 case: fetch failed, so the booking question is open.
    const r = assessReadiness(ready({ onlineBookingStatus: "UNKNOWN" }));
    check("an unanswered booking question is held", !r.ready);
    check("and the reason is booking-unknown", r.reason === "booking-unknown", String(r.reason));
    check("the explanation mentions the website not loading", r.explanation.includes("would not load"));
  }

  {
    // The 23,941 case: no website at all. Tempting to call it "no booking" and
    // bank the points; wrong, because they may well be on Booksy.
    const r = assessReadiness(ready({ website: null, websiteCheckedAt: null, onlineBookingStatus: "UNKNOWN" }));
    check("a business with no website is held, not assumed", !r.ready);
    check("its reason is the unanswered question, not 'never researched'", r.reason === "booking-unknown", String(r.reason));
    check("and the explanation names the possibility", r.explanation.includes("Booksy"));
  }

  {
    // The whole point of versioning: an old answer is not a current answer.
    const r = assessReadiness(ready({ analysisVersion: ANALYSIS_VERSION - 1 }));
    check("a lead judged by an older method is held", !r.ready);
    check("and the reason is the stale method", r.reason === "stale-method", String(r.reason));
  }

  check(
    "a lead with no version at all is held",
    !assessReadiness(ready({ analysisVersion: null })).ready
  );
  check(
    "a duplicate is never ready",
    !assessReadiness(ready({ isDuplicateOf: "other-lead" })).ready
  );
  check(
    "the duplicate reason wins over everything else",
    assessReadiness(ready({ isDuplicateOf: "x", analysisVersion: null, onlineBookingStatus: "UNKNOWN" })).reason ===
      "duplicate"
  );

  section("A future version invalidates today's leads");

  // Bumping ANALYSIS_VERSION must sweep everything back into holding — that is
  // the mechanism by which improving the research never leaves a stale ranking
  // standing.
  check(
    "today's fully-researched lead would be held by a future version",
    !assessReadiness({ ...ready(), analysisVersion: ANALYSIS_VERSION }).ready === false &&
      assessReadiness({ ...ready(), analysisVersion: ANALYSIS_VERSION - 1 }).reason === "stale-method"
  );

  section("Every reason has words");

  for (const reason of ["never-researched", "booking-unknown", "stale-method", "duplicate"] as const) {
    const label = describeHoldReason(reason);
    check(`"${reason}" has a label`, label.length > 0 && !label.includes("_"), label);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\nFailures:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
}

main();
