/**
 * The research queues, against a real database.
 *
 * These queues have a property that is easy to get wrong and impossible to see
 * from the code: a lead STAYS IN THE QUEUE after being processed. A website
 * that was unreachable is still worth another go later; a business the booking
 * platforms could not settle is still unsettled. Membership is not consumed by
 * the work.
 *
 * That makes ordering load-bearing. Ordered by score, the same top rows come
 * back on every single run — and every run reports a healthy "checked 800", so
 * the logs look like progress while the backlog behind them never moves. That
 * is not a hypothetical: it ran that way for about thirteen hours, re-reading
 * the same 800 websites every five minutes with 39,000 leads waiting.
 *
 * So the property under test is not "the filter selects the right rows" but
 * the stricter one: RUN THE QUEUE REPEATEDLY AND IT MUST DRAIN.
 *
 *   npm run test-queues
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSqliteClient, SqliteLeadsRepository } from "@market-outreach/db";
import { ANALYSIS_VERSION, type Lead } from "@market-outreach/core";

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

function makeRepo(): SqliteLeadsRepository {
  const db = new Database(":memory:");
  db.exec(readFileSync(join(process.cwd(), "packages", "db", "src", "schema.sql"), "utf8"));
  // leads.campaign_id is NOT NULL and a foreign key, so every fixture needs a
  // campaign to belong to.
  db.prepare(
    `INSERT INTO campaigns (id, name, city, industry, status, batch_size, priority,
      target_lead_count, created_at, updated_at)
     VALUES ('camp-1', 'Test', 'Miami', 'hair-salons', 'ACTIVE', 10, 1, 100,
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`
  ).run();
  db.prepare(
    `INSERT INTO jobs (id, campaign_id, city, industry, batch_id, status, created_at, updated_at)
     VALUES ('job-1', 'camp-1', 'Miami', 'hair-salons', 'batch-1', 'COMPLETED',
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`
  ).run();
  return new SqliteLeadsRepository(createSqliteClient(db));
}

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
    website: "https://salon.example/",
    websiteStatus: "EXISTS",
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

/** A clock that advances a minute per tick, so ordering by timestamp is meaningful. */
function clock(start = Date.UTC(2026, 7, 27, 0, 0, 0)): () => string {
  let t = start;
  return () => {
    t += 60_000;
    return new Date(t).toISOString();
  };
}

async function main(): Promise<void> {
  section("The re-check queue drains");

  {
    const repo = makeRepo();
    const now = clock();
    // Twenty leads, all already read once by an older pass, all still
    // unresolved — the exact shape of the production backlog. Scores differ so
    // a score ordering has a stable favourite to keep returning.
    const seeded: Lead[] = [];
    for (let i = 0; i < 20; i += 1) {
      seeded.push(
        lead({
          prospectScore: 100 - i,
          websiteStatus: "UNREACHABLE",
          websiteCheckedAt: "2026-08-01T00:00:00.000Z",
          analysisVersion: 1,
        })
      );
    }
    await repo.upsertMany(seeded);

    // Five runs of four. If the queue drains, that is every lead exactly once.
    const seen = new Map<string, number>();
    for (let run = 0; run < 5; run += 1) {
      const batch = await repo.list({
        needsWebsiteRecheck: new Date().toISOString(),
        orderBy: "least-recently-checked",
        limit: 4,
      });
      const stamp = now();
      for (const item of batch) seen.set(item.id, (seen.get(item.id) ?? 0) + 1);
      // Processing stamps the lead and leaves it otherwise unresolved, which
      // is what a still-unreachable site does.
      await repo.upsertMany(batch.map((item) => ({ ...item, websiteCheckedAt: stamp })));
    }

    check(
      "five runs of four cover twenty distinct leads",
      seen.size === 20,
      `covered ${seen.size}`
    );
    check(
      "no lead is handed out twice while others wait",
      [...seen.values()].every((count) => count === 1),
      `repeats: ${[...seen.entries()].filter(([, c]) => c > 1).map(([id]) => id).join(", ")}`
    );
  }

  {
    // The bug itself, pinned. Score ordering on this queue is not a style
    // preference — it is the failure. If someone changes it back, this fails.
    const repo = makeRepo();
    const now = clock();
    const seeded: Lead[] = [];
    for (let i = 0; i < 20; i += 1) {
      seeded.push(
        lead({
          prospectScore: 100 - i,
          websiteStatus: "UNREACHABLE",
          websiteCheckedAt: "2026-08-01T00:00:00.000Z",
          analysisVersion: 1,
        })
      );
    }
    await repo.upsertMany(seeded);

    const seen = new Set<string>();
    for (let run = 0; run < 5; run += 1) {
      const batch = await repo.list({
        needsWebsiteRecheck: new Date().toISOString(),
        orderBy: "score",
        limit: 4,
      });
      const stamp = now();
      for (const item of batch) seen.add(item.id);
      await repo.upsertMany(batch.map((item) => ({ ...item, websiteCheckedAt: stamp })));
    }

    check(
      "score ordering demonstrably does NOT drain this queue",
      seen.size === 4,
      `covered ${seen.size} of 20 — if this is now 20 the ordering changed and the guard above is what matters`
    );
  }

  section("The booking-directory queue");

  {
    const repo = makeRepo();
    const now = clock();
    const cooldown = "2026-07-28T00:00:00.000Z";

    await repo.upsertMany([
      // Read, still unknown — the case the directories exist for.
      lead({ id: "read-unknown", websiteCheckedAt: "2026-08-20T00:00:00.000Z" }),
      // No website at all. Nothing for the Website Analyst to read, so without
      // the directories this lead is stuck in the holding area forever.
      lead({ id: "no-website", website: null, websiteStatus: "NONE" }),
      // Not read yet — the Website Analyst has not had its turn.
      lead({ id: "not-read-yet", websiteCheckedAt: null }),
      // Settled. Nothing left to ask.
      lead({
        id: "settled",
        websiteCheckedAt: "2026-08-20T00:00:00.000Z",
        onlineBookingStatus: "NONE",
        analysisVersion: ANALYSIS_VERSION,
      }),
      // A duplicate never reaches a call list, so it must not cost a lookup.
      lead({ id: "dupe", websiteCheckedAt: "2026-08-20T00:00:00.000Z", isDuplicateOf: "read-unknown" }),
      // Searched recently and still unsettled — inside the cooldown.
      lead({
        id: "just-looked-up",
        websiteCheckedAt: "2026-08-20T00:00:00.000Z",
        directoryCheckedAt: "2026-08-26T00:00:00.000Z",
      }),
    ]);

    const queue = await repo.list({ awaitingDirectoryLookup: cooldown, orderBy: "least-recently-looked-up" });
    const ids = queue.map((item) => item.id).sort();

    check(
      "queues leads the Website Analyst could not settle",
      ids.includes("read-unknown")
    );
    check(
      "queues leads with no website at all",
      ids.includes("no-website"),
      "these can never be settled by reading a site, so excluding them strands them permanently"
    );
    check(
      "waits for the Website Analyst before spending a lookup",
      !ids.includes("not-read-yet")
    );
    check("leaves settled leads alone", !ids.includes("settled"));
    check("never spends a paid lookup on a duplicate", !ids.includes("dupe"));
    check(
      "respects the cooldown on a recent unsuccessful lookup",
      !ids.includes("just-looked-up"),
      "without this the queue re-searches the same unresolvable leads forever, at half a cent each"
    );

    // And it drains: stamping is enough to move a lead out of the queue.
    const stamp = now();
    await repo.upsertMany(queue.map((item) => ({ ...item, directoryCheckedAt: stamp })));
    const after = await repo.list({ awaitingDirectoryLookup: cooldown });
    check("stamping a lead removes it from the queue", after.length === 0, `${after.length} left`);
  }

  section("Never-looked-up leads go first");

  {
    const repo = makeRepo();
    await repo.upsertMany([
      lead({ id: "looked-up-long-ago", websiteCheckedAt: "2026-08-20T00:00:00.000Z", directoryCheckedAt: "2026-01-01T00:00:00.000Z", prospectScore: 99 }),
      lead({ id: "never-looked-up", websiteCheckedAt: "2026-08-20T00:00:00.000Z", directoryCheckedAt: null, prospectScore: 1 }),
    ]);
    const queue = await repo.list({
      awaitingDirectoryLookup: "2026-07-28T00:00:00.000Z",
      orderBy: "least-recently-looked-up",
    });
    check(
      "a lead nobody has looked up outranks one looked up in January",
      queue[0]?.id === "never-looked-up",
      `got ${queue[0]?.id}`
    );
  }

  section("A stale analysis version is reachable");

  {
    // The re-check queue is the only route back to leads decided by an older
    // method. If it excluded them, improving the analyser could never reach
    // the leads the old one already ruled on.
    const repo = makeRepo();
    await repo.upsertMany([
      lead({
        id: "old-method-said-none",
        websiteCheckedAt: "2026-08-01T00:00:00.000Z",
        onlineBookingStatus: "NONE",
        analysisVersion: ANALYSIS_VERSION - 1,
      }),
    ]);
    const queue = await repo.list({ needsWebsiteRecheck: new Date().toISOString() });
    check("a lead judged NONE by an older method is re-checkable", queue.length === 1);
  }

  console.log("\n" + "=".repeat(40));
  console.log(`${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`Failed: ${failures.join(", ")}`);
  console.log("=".repeat(40));
  if (failed > 0) process.exitCode = 1;
}

void main();
