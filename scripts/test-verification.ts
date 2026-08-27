/**
 * Manual override: a person's answer, and what has to be true for it to be
 * worth paying someone to give one.
 *
 * The owner's framing was explicit — hire someone at two hundred dollars a day
 * to work through the leads the robots could not settle. That price sets the
 * requirements. A day's answers must survive every sweep that put those leads
 * in the holding area, including future improvements to the research, and it
 * must be possible to see who said what in order to check the work.
 *
 * So the tests here are mostly not about writing fields. They are about the
 * ways a day's wages could be thrown away without anyone noticing.
 *
 *   npm run test-verification
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSqliteClient, SqliteLeadsRepository } from "@market-outreach/db";
import {
  ANALYSIS_VERSION,
  applyVerification,
  assessReadiness,
  bookingStatusFor,
  isHumanVerified,
  KNOWN_BOOKING_PROVIDERS,
  type Lead,
} from "@market-outreach/core";

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

const WHEN = "2026-08-27T09:00:00.000Z";
const WHO = "researcher@example.com";

let seq = 0;
function lead(overrides: Partial<Lead> = {}): Lead {
  seq += 1;
  return {
    id: `lead-${String(seq).padStart(4, "0")}`,
    businessName: `Salon ${seq}`,
    industry: "hair-salons",
    address: "1 Main St",
    city: "Miami",
    state: "FL",
    zip: "33101",
    phone: null,
    email: null,
    website: null,
    websiteStatus: "NONE",
    websiteQuality: "UNKNOWN",
    onlineBookingStatus: "UNKNOWN",
    bookingProvider: null,
    bookingMethod: "UNKNOWN",
    staffCount: null,
    staffCountConfidence: "LOW",
    rating: null,
    reviewCount: null,
    instagram: null,
    facebook: null,
    socialActivity: "UNKNOWN",
    locationCount: null,
    services: [],
    prospectScore: 25,
    scoreBreakdown: [],
    scoreReason: null,
    dataConfidence: "LOW",
    discoverySource: "test",
    externalId: null,
    sourceConfidence: null,
    latitude: null,
    longitude: null,
    websiteCheckedAt: null,
    analysisVersion: null,
    directoryCheckedAt: null,
    verifiedBy: null,
    verifiedAt: null,
    dateDiscovered: "2026-08-01T00:00:00.000Z",
    dateLastResearched: null,
    researchStatus: "PENDING",
    qualificationStatus: "UNQUALIFIED",
    pipelineStage: "DISCOVERED",
    campaignId: "camp-1",
    jobId: "job-1",
    isDuplicateOf: null,
    stagesCompleted: [],
    linkInBioUrl: null,
    detectedLinks: [],
    serviceArea: null,
    locationConfidence: "UNKNOWN",
    locationEvidence: [],
    notes: "",
    ...overrides,
  } as Lead;
}

function makeRepo(): SqliteLeadsRepository {
  const db = new Database(":memory:");
  db.exec(readFileSync(join(process.cwd(), "packages", "db", "src", "schema.sql"), "utf8"));
  db.prepare(
    `INSERT INTO campaigns (id, name, city, industry, status, batch_size, priority,
      target_lead_count, created_at, updated_at)
     VALUES ('camp-1','Test','Miami','hair-salons','ACTIVE',10,1,100,
      '2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z')`
  ).run();
  db.prepare(
    `INSERT INTO jobs (id, campaign_id, city, industry, batch_id, status, created_at, updated_at)
     VALUES ('job-1','camp-1','Miami','hair-salons','batch-1','COMPLETED',
      '2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z')`
  ).run();
  return new SqliteLeadsRepository(createSqliteClient(db));
}

async function main(): Promise<void> {
  section("Recording what a person found");

  {
    const { lead: updated, changes, settlesBooking } = applyVerification(lead(), {
      bookingProvider: "none",
      verifiedBy: WHO,
      verifiedAt: WHEN,
    });
    check("'no online booking' is recorded as NONE, not UNKNOWN", updated.onlineBookingStatus === "NONE");
    check("no provider is named", updated.bookingProvider === null);
    check("it settles the booking question", settlesBooking);
    check("and it is attributed", updated.verifiedBy === WHO && updated.verifiedAt === WHEN);
    check("the change is described for the audit trail", changes.some((c) => c.includes("No online booking")), changes.join("; "));
  }

  {
    const { lead: updated } = applyVerification(lead(), {
      bookingProvider: "Booksy",
      verifiedBy: WHO,
      verifiedAt: WHEN,
    });
    check("a marketplace is THIRD_PARTY", updated.onlineBookingStatus === "THIRD_PARTY_BOOKING_SYSTEM");
    check("and the platform is named exactly as the list spells it", updated.bookingProvider === "Booksy");
    check("booking method follows", updated.bookingMethod === "ONLINE_THIRD_PARTY");
  }

  {
    // Acuity and Calendly bolt onto a business's own site rather than being a
    // marketplace someone finds them through. Scoring treats those differently,
    // so the distinction has to survive the dropdown.
    const { lead: updated } = applyVerification(lead(), {
      bookingProvider: "Acuity",
      verifiedBy: WHO,
      verifiedAt: WHEN,
    });
    check("a tool bolted onto their own site is INTEGRATED", updated.onlineBookingStatus === "INTEGRATED_BOOKING_SYSTEM");
    check("and its booking method says so", updated.bookingMethod === "ONLINE_INTEGRATED");
  }

  {
    const withSocial = lead({ instagram: "https://instagram.com/salon" });
    const { lead: updated } = applyVerification(withSocial, {
      bookingProvider: "none",
      verifiedBy: WHO,
      verifiedAt: WHEN,
    });
    check("no booking but a social presence means they can be messaged", updated.bookingMethod === "SOCIAL_DM");
  }

  {
    const { lead: updated } = applyVerification(lead(), {
      bookingProvider: "none",
      verifiedBy: WHO,
      verifiedAt: WHEN,
    });
    check("no booking and no social means phone only", updated.bookingMethod === "PHONE_ONLY");
  }

  section("Website answers");

  {
    const { lead: updated } = applyVerification(lead({ website: "https://old.example/" }), {
      hasWebsite: false,
      verifiedBy: WHO,
      verifiedAt: WHEN,
    });
    check("'no website' clears the address", updated.website === null);
    check("and records the status", updated.websiteStatus === "NONE");
    check(
      "and marks it as looked at, so no queue re-reads it",
      updated.websiteCheckedAt === WHEN,
      "without this the site sits in the never-read queue despite someone having just looked"
    );
  }

  {
    const { lead: updated } = applyVerification(lead(), {
      hasWebsite: true,
      website: "  https://found.example/  ",
      verifiedBy: WHO,
      verifiedAt: WHEN,
    });
    check("a found address is trimmed and kept", updated.website === "https://found.example/", String(updated.website));
    check("and the status says a site exists", updated.websiteStatus === "EXISTS");
  }

  {
    const before = lead({ website: "https://keep.example/", websiteStatus: "EXISTS" });
    const { lead: updated, settlesBooking } = applyVerification(before, {
      note: "Rang them, no answer",
      verifiedBy: WHO,
      verifiedAt: WHEN,
    });
    check("answering neither question leaves both alone", updated.website === before.website);
    check("and does not claim to settle booking", !settlesBooking);
    check(
      "an unanswered booking question does not open the gate",
      !assessReadiness(updated).ready,
      "a half-filled form must not put a lead on the call list"
    );
    check("but the note is kept", updated.locationEvidence.some((e) => e.includes("no answer")));
  }

  section("The provider list");

  check("the dropdown offers the platforms we crawl", ["Booksy", "Vagaro"].every((p) => KNOWN_BOOKING_PROVIDERS.includes(p as never)));
  check("and the one the owner named", KNOWN_BOOKING_PROVIDERS.includes("The Cut" as never));
  check("with an escape hatch", KNOWN_BOOKING_PROVIDERS.some((p) => p.startsWith("Other")));
  check(
    "every listed provider maps to a real booking status",
    KNOWN_BOOKING_PROVIDERS.every((p) => bookingStatusFor(p) !== "UNKNOWN" && bookingStatusFor(p) !== "NONE")
  );
  check("and 'none' is the one that means no booking", bookingStatusFor("none") === "NONE");

  section("A day's work survives the machinery");

  {
    // The whole point. Someone verifies a lead; every queue in the system must
    // then leave it alone, or the next cron overwrites what was paid for.
    const repo = makeRepo();
    const { lead: verified } = applyVerification(
      lead({
        id: "hand-checked",
        website: "https://salon.example/",
        websiteStatus: "UNREACHABLE",
        websiteCheckedAt: "2026-08-01T00:00:00.000Z",
        analysisVersion: 1,
      }),
      { bookingProvider: "none", hasWebsite: true, website: "https://salon.example/", verifiedBy: WHO, verifiedAt: WHEN }
    );
    await repo.upsert(verified);
    // And an untouched lead in the same shape, as the control.
    await repo.upsert(
      lead({
        id: "not-checked",
        website: "https://other.example/",
        websiteStatus: "UNREACHABLE",
        websiteCheckedAt: "2026-08-01T00:00:00.000Z",
        analysisVersion: 1,
      })
    );

    const recheck = await repo.list({ needsWebsiteRecheck: new Date().toISOString() });
    check(
      "the website re-sweep skips a hand-checked lead",
      recheck.every((l) => l.id !== "hand-checked"),
      recheck.map((l) => l.id).join(", ")
    );
    check("but still picks up the one nobody checked", recheck.some((l) => l.id === "not-checked"));

    const directory = await repo.list({ awaitingDirectoryLookup: new Date().toISOString() });
    check(
      "the booking-directory queue skips it too",
      directory.every((l) => l.id !== "hand-checked"),
      directory.map((l) => l.id).join(", ")
    );

    const awaiting = await repo.list({ awaitingWebsiteCheck: true });
    check("and so does the never-read queue", awaiting.every((l) => l.id !== "hand-checked"));
  }

  {
    // A version bump is the subtle one: it is meant to re-open everything the
    // old method decided, and it must not re-open what a person decided.
    const repo = makeRepo();
    const { lead: verified } = applyVerification(lead({ id: "hand-checked", analysisVersion: 1 }), {
      bookingProvider: "Vagaro",
      verifiedBy: WHO,
      verifiedAt: WHEN,
    });
    await repo.upsert(verified);

    const readyNow = await repo.list({ readyForReview: { ready: true, analysisVersion: ANALYSIS_VERSION } });
    check("a hand-checked lead is on the working list today", readyNow.some((l) => l.id === "hand-checked"));

    const readyAfterBump = await repo.list({ readyForReview: { ready: true, analysisVersion: ANALYSIS_VERSION + 5 } });
    check(
      "and stays there after five future improvements to the research",
      readyAfterBump.some((l) => l.id === "hand-checked"),
      "this is the test that protects the wages"
    );

    const held = await repo.count({ readyForReview: { ready: false, analysisVersion: ANALYSIS_VERSION + 5 } });
    check("and is not counted as held", held === 0, String(held));
  }

  section("A website you supply actually gets read");

  {
    // The round trip that prompted this. Someone finds a site the automated
    // search missed and types it in. Their answer settles booking; the PAGE
    // still has to be opened, because how neglected it looks and how many
    // staff it names are most of the score, and typing a URL supplies none of
    // that.
    const repo = makeRepo();
    const { lead: verified } = applyVerification(
      lead({ id: "found-a-site", website: null, websiteStatus: "NONE", websiteCheckedAt: null }),
      {
        hasWebsite: true,
        website: "https://bellahair.example/",
        bookingProvider: "none",
        verifiedBy: WHO,
        verifiedAt: WHEN,
      }
    );

    check("the address is stored", verified.website === "https://bellahair.example/");
    check(
      "and is deliberately left UNREAD so the analyst opens it",
      verified.websiteCheckedAt === null,
      "stamping it read was the bug: the page scores as though it were blank"
    );

    await repo.upsert(verified);
    const queue = await repo.list({ awaitingWebsiteCheck: true });
    check(
      "so it appears in the reading queue despite being hand-checked",
      queue.some((l) => l.id === "found-a-site"),
      queue.map((l) => l.id).join(", ")
    );
  }

  {
    // Nothing outstanding: no site to read.
    const { lead: verified } = applyVerification(lead({ website: "https://gone.example/" }), {
      hasWebsite: false,
      verifiedBy: WHO,
      verifiedAt: WHEN,
    });
    check("'no website' leaves nothing to read", verified.websiteCheckedAt === WHEN && verified.website === null);
  }

  {
    // Confirming an address we already read is not new work either.
    const already = lead({ website: "https://known.example/", websiteCheckedAt: "2026-08-20T00:00:00.000Z" });
    const { lead: verified } = applyVerification(already, {
      hasWebsite: true,
      website: "https://known.example/",
      verifiedBy: WHO,
      verifiedAt: WHEN,
    });
    check("confirming a site we already read does not re-queue it", verified.websiteCheckedAt === WHEN);
  }

  {
    const repo = makeRepo();
    const { lead: verified } = applyVerification(
      lead({ id: "unread-site", website: "https://never-read.example/", websiteCheckedAt: null }),
      { bookingProvider: "Booksy", verifiedBy: WHO, verifiedAt: WHEN }
    );
    await repo.upsert(verified);
    const queue = await repo.list({ awaitingWebsiteCheck: true });
    check(
      "a site nobody had read stays queued even after a booking answer",
      queue.some((l) => l.id === "unread-site"),
      "the person answered booking, not what the page says"
    );
  }

  section("Seeing the work that was paid for");

  {
    const repo = makeRepo();
    const { lead: mine } = applyVerification(lead({ id: "a" }), {
      bookingProvider: "none",
      verifiedBy: "owner@example.com",
      verifiedAt: WHEN,
    });
    const { lead: theirs } = applyVerification(lead({ id: "b" }), {
      bookingProvider: "Booksy",
      verifiedBy: WHO,
      verifiedAt: WHEN,
    });
    await repo.upsertMany([mine, theirs, lead({ id: "c" })]);

    const checkedByHand = await repo.list({ humanVerified: true });
    check("hand-checked leads can be listed on their own", checkedByHand.length === 2, String(checkedByHand.length));
    check(
      "each one says who answered",
      checkedByHand.every((l) => Boolean(l.verifiedBy)),
      "an unattributable answer cannot be spot-checked, which is the point of paying by the day"
    );
    check("and the rest are still listable", (await repo.list({ humanVerified: false })).length === 1);
  }

  check("the predicate agrees with the column", isHumanVerified({ verifiedAt: WHEN }) && !isHumanVerified({ verifiedAt: null }));

  console.log("\n" + "=".repeat(40));
  console.log(`${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`Failed: ${failures.join(", ")}`);
  console.log("=".repeat(40));
  if (failed > 0) process.exitCode = 1;
}

void main();
