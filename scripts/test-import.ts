/**
 * Tests for turning real Overture records into leads.
 *
 * Most of these exist to prove restraint: the mapper records what the source
 * said and refuses to fill the gaps. A test that catches us inventing a booking
 * status is worth more here than one that checks a field was copied across.
 *
 *   npm run test-import
 */
import {
  observationToLead,
  normalizePhone,
  realWebsite,
  computeDataConfidence,
  type Lead,
  scoreLead,
  getScoringConfig,
  MockReasoningProvider,
  type OvertureObservation,
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

function observation(overrides: Partial<OvertureObservation> = {}): OvertureObservation {
  return {
    overtureId: "077d2c99-6dd0-4db9-b000-000000000000",
    name: "Viana Beauty Salon",
    industry: "hair-salons",
    overtureCategory: "hair_salon",
    alternateCategories: ["skin_care"],
    address: "11760 SW 199th St",
    city: "Miami",
    state: "FL",
    zip: "33177",
    websites: ["https://www.vianabeautysalon.com/"],
    phones: ["3059884469"],
    socials: [],
    emails: [],
    confidence: 0.94,
    latitude: 25.58,
    longitude: -80.39,
    ...overrides,
  };
}

const context = { campaignId: "camp-1", jobId: "job-1", now: "2026-08-25T19:00:00.000Z" };

async function main() {
  section("Phone normalisation");
  check("ten digits", normalizePhone("3059884469") === "(305) 988-4469", String(normalizePhone("3059884469")));
  check("E.164 with country code", normalizePhone("+17864043049") === "(786) 404-3049", String(normalizePhone("+17864043049")));
  check("already formatted", normalizePhone("(305) 279-7942") === "(305) 279-7942");
  check(
    "three spellings of one number converge, so dedup can compare them",
    new Set([
      normalizePhone("3052797942"),
      normalizePhone("+13052797942"),
      normalizePhone("(305) 279-7942"),
    ]).size === 1
  );
  check("nothing for nothing", normalizePhone(undefined) === null);
  check("a number it cannot parse is kept, not discarded", normalizePhone("911") === "911");

  section("Telling a website from a social page");
  check("a real domain is a website", realWebsite(["http://www.t-nail.com"]) === "http://www.t-nail.com");
  check(
    "a Facebook page filed as a website is NOT a website",
    realWebsite(["https://www.facebook.com/154059531327540"]) === null
  );
  check(
    "the real site wins when both are listed",
    realWebsite(["https://www.facebook.com/123", "http://kairoshairsalon.com"]) === "http://kairoshairsalon.com"
  );
  check("no websites at all", realWebsite([]) === null);
  check("unparseable urls are skipped, not thrown on", realWebsite(["not a url"]) === null);

  section("What the mapper refuses to invent");
  const lead = observationToLead(observation(), context);
  check("booking status is unknown, not none", lead.onlineBookingStatus === "UNKNOWN", lead.onlineBookingStatus);
  check("booking method is unknown, not none", lead.bookingMethod === "UNKNOWN", lead.bookingMethod);
  check("website quality is unknown even though a website exists", lead.websiteQuality === "UNKNOWN");
  check("social activity is unknown from a profile url alone", lead.socialActivity === "UNKNOWN");
  check("no staff count is guessed", lead.staffCount === null);
  check("no rating is guessed", lead.rating === null);
  check("no review count is guessed", lead.reviewCount === null);
  check("no services are guessed from the category", lead.services.length === 0);
  check("no link-in-bio is guessed", lead.linkInBioUrl === null);

  section("What the mapper does record");
  check("business name", lead.businessName === "Viana Beauty Salon");
  check("phone is normalised on the way in", lead.phone === "(305) 988-4469");
  check("website presence", lead.websiteStatus === "EXISTS");
  check("zip", lead.zip === "33177");
  check("state", lead.state === "FL");
  check("the source id, so a re-import updates", lead.externalId === observation().overtureId);
  check("the source's own confidence, kept apart from ours", lead.sourceConfidence === 0.94);
  check("coordinates", lead.latitude === 25.58 && lead.longitude === -80.39);
  check("discovery source names the dataset", lead.discoverySource === "overture-places");
  check(
    "stages claim discovery and enrichment only",
    lead.stagesCompleted.join(",") === "discovery,enrichment",
    lead.stagesCompleted.join(",")
  );
  check("website analysis is NOT claimed", !lead.stagesCompleted.includes("website_analysis"));
  check("evidence cites the source category", lead.locationEvidence.some((e) => e.includes("hair_salon")));
  check(
    "an existing id is reused so a refresh updates in place",
    observationToLead(observation(), { ...context, existingId: "existing-lead" }).id === "existing-lead"
  );

  section("A social profile filed under websites still counts as social");
  const social = observationToLead(
    observation({ websites: ["https://www.facebook.com/893680724169761"], socials: [] }),
    context
  );
  check("facebook is picked up", social.facebook === "https://www.facebook.com/893680724169761");
  check("and it does not become a website", social.websiteStatus === "NONE", social.websiteStatus);

  section("A missing address is not a missing business");
  const mobile = observationToLead(observation({ address: "", industry: "makeup-artists" }), context);
  check("location confidence drops", mobile.locationConfidence === "LOW");
  check("the lead survives without a street address", mobile.businessName === "Viana Beauty Salon");

  section("Confidence measures things that can actually be known");

  {
    const cfg = getScoringConfig();

    /**
     * The bug this pins. Confidence used to be measured over seven fields,
     * three of which — staff count, rating, review count — were never
     * populated for a single lead in seventy-seven thousand. HIGH needed 80%
     * of seven, so it was arithmetically unreachable, and the badge quietly
     * degenerated into "has a website / does not": it labelled the best
     * prospects in the database, the ones with no website, as the least
     * trustworthy data.
     */
    const fullyKnown: Lead = {
      ...lead,
      phone: "3055550101",
      website: null,
      websiteStatus: "NONE",
      websiteCheckedAt: "2026-08-27T00:00:00.000Z",
      onlineBookingStatus: "NONE",
      analysisVersion: 2,
    };
    const best = computeDataConfidence(fullyKnown, cfg);
    check(
      "a lead with NO website but every question answered reads HIGH",
      best.level === "HIGH",
      `${best.level} — ${best.reason}`
    );
    check(
      "and its reason lists what is established rather than a fraction",
      best.reason.includes("book online"),
      best.reason
    );

    // The inversion, stated directly: having no website must not be worth less
    // than having one, all else equal.
    const withSite = computeDataConfidence(
      { ...fullyKnown, website: "https://salon.example/", websiteStatus: "EXISTS" },
      cfg
    );
    check(
      "having no website is worth no less than having one",
      best.resolvedRatio >= withSite.resolvedRatio,
      `${best.resolvedRatio} vs ${withSite.resolvedRatio}`
    );

    // And HIGH has to be reachable at all, which it previously was not.
    check("HIGH is attainable from data this system actually collects", best.level === "HIGH");
  }

  {
    const cfg = getScoringConfig();
    const answered: Lead = {
      ...lead,
      phone: "3055550101",
      onlineBookingStatus: "NONE",
      websiteStatus: "NONE",
      website: null,
      analysisVersion: 1,
    };
    const stale = computeDataConfidence(answered, cfg);
    check("an older research method costs confidence but is not fatal", stale.level === "MEDIUM", stale.level);
    check("and the reason says which method", stale.reason.includes("older method"), stale.reason);
  }

  {
    const cfg = getScoringConfig();
    // The booking question is what the pitch rests on and what the readiness
    // gate holds a lead back for. Missing it is not "three-quarters
    // trustworthy" — it is a lead nobody should be ringing yet.
    const noBookingAnswer: Lead = {
      ...lead,
      phone: "3055550101",
      email: "hi@salon.example",
      website: "https://salon.example/",
      websiteStatus: "EXISTS",
      onlineBookingStatus: "UNKNOWN",
      analysisVersion: 2,
    };
    const result = computeDataConfidence(noBookingAnswer, cfg);
    check(
      "an unanswered booking question caps confidence at LOW",
      result.level === "LOW",
      `${result.level} — three of four checks pass, and it still must not read as trustworthy`
    );
  }

  {
    const cfg = getScoringConfig();
    const unreachable: Lead = {
      ...lead,
      phone: "3055550101",
      website: "https://dead.example/",
      websiteStatus: "UNREACHABLE",
      onlineBookingStatus: "NONE",
      analysisVersion: 2,
    };
    check(
      "a site we tried and could not reach still counts as established",
      computeDataConfidence(unreachable, cfg).level === "HIGH",
      "we looked; that is the finding"
    );
  }

  {
    // A config naming nothing this code can check would otherwise divide by
    // zero and grade every lead identically — the exact failure being fixed.
    const broken = { ...getScoringConfig(), confidence: { description: "", keyFields: ["nonsense"], thresholds: { high: 1, medium: 0.5 } } };
    const result = computeDataConfidence(lead, broken);
    check("an unrecognised config grades LOW and says so", result.level === "LOW" && result.reason.includes("configured"), result.reason);
  }

  section("UNKNOWN must not inflate data confidence");
  const config = getScoringConfig();
  const withUnknowns = computeDataConfidence(lead, config);
  check("a barely-researched lead reports LOW confidence", withUnknowns.level === "LOW", withUnknowns.level);
  // NONE is excluded from the resolved count too, so the comparison has to be
  // against a value that genuinely settles the question.
  check(
    "UNKNOWN booking status does not count as a resolved field",
    computeDataConfidence({ ...lead, onlineBookingStatus: "THIRD_PARTY_BOOKING_SYSTEM" }, config).resolvedRatio >
      withUnknowns.resolvedRatio
  );
  // NONE, by contrast, IS a researched value: somebody read their site and the
  // answer was none. It has to raise confidence, or checking a prospect's
  // website could never make them better understood.
  check(
    "but NONE does count, because it is an answer",
    computeDataConfidence({ ...lead, onlineBookingStatus: "NONE" }, config).resolvedRatio >
      withUnknowns.resolvedRatio
  );

  section("Scoring an imported lead");
  const reasoning = new MockReasoningProvider();
  const noSite = observationToLead(
    observation({ websites: [], socials: ["https://www.instagram.com/fade"] }),
    context
  );
  const scoredNoSite = await scoreLead(noSite, config, reasoning);
  const scoredWithSite = await scoreLead(lead, config, reasoning);
  check(
    "no website outscores has website",
    scoredNoSite.score > scoredWithSite.score,
    `${scoredNoSite.score} vs ${scoredWithSite.score}`
  );
  check("the no-website factor is credited", scoredNoSite.breakdown.some((f) => f.id === "no-website"));
  check(
    "social-but-no-website is credited, because both halves were observed",
    scoredNoSite.breakdown.some((f) => f.id === "social-presence-no-website")
  );
  check(
    "no points are awarded for booking, because nobody looked",
    !scoredNoSite.breakdown.some((f) => f.id === "no-online-booking")
  );
  check(
    "nothing reaches qualified on discovery data alone",
    scoredNoSite.score < 60,
    String(scoredNoSite.score)
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log(`Failures:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
