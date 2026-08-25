/**
 * Loads real businesses from an Overture extract into the lead database and scores them.
 *
 *   python3 scripts/fetch-overture.py --state FL --out data/overture-fl.ndjson
 *   npx tsx scripts/import-overture.ts --file data/overture-fl.ndjson --state FL
 *
 * Idempotent: leads are matched on the Overture place id, so re-running against
 * a newer extract refreshes what changed instead of duplicating everything. That
 * is what makes a scheduled refresh possible rather than a rebuild.
 *
 * ORGANISATION. One campaign per (state, industry) — "Florida — Barbers" — with
 * the real city and ZIP living on each lead. The alternative, a campaign per
 * city, does not survive contact with reality: this one state has 714 distinct
 * cities in the data, and nobody is maintaining 9,000 campaigns. State is the
 * unit you expand by, industry is the unit you sell to, and city and ZIP are
 * how you filter and cluster once you are working the list.
 */
import fs from "node:fs";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import {
  observationToLead,
  scoreLead,
  qualificationStatusForScore,
  getScoringConfig,
  getIndustries,
  MockReasoningProvider,
  type OvertureObservation,
  type Campaign,
  type Job,
  type Lead,
} from "@market-outreach/core";
import { createRepositories } from "@market-outreach/db";

interface Args {
  file: string;
  state: string;
  limit: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    if (hit) return hit.split("=").slice(1).join("=");
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const file = get("file");
  const state = get("state");
  if (!file || !state) {
    console.error("Usage: npx tsx scripts/import-overture.ts --file <ndjson> --state <XX> [--limit N] [--dry-run]");
    process.exit(1);
  }
  return {
    file,
    state: state.toUpperCase(),
    limit: Number(get("limit") ?? 0) || 0,
    dryRun: args.includes("--dry-run"),
  };
}

const STATE_NAMES: Record<string, string> = {
  FL: "Florida", GA: "Georgia", TX: "Texas", CA: "California", NY: "New York",
  NC: "North Carolina", AZ: "Arizona", IL: "Illinois", PA: "Pennsylvania",
  OH: "Ohio", NJ: "New Jersey", WA: "Washington", MA: "Massachusetts",
  TN: "Tennessee", CO: "Colorado", NV: "Nevada",
};

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  const args = parseArgs();
  const repos = createRepositories();
  const scoringConfig = getScoringConfig();
  const reasoning = new MockReasoningProvider();
  const industryLabels = new Map(getIndustries().map((i) => [i.id, i.label]));
  const stateName = STATE_NAMES[args.state] ?? args.state;

  if (!fs.existsSync(args.file)) {
    console.error(`No such file: ${args.file}. Run scripts/fetch-overture.py first.`);
    process.exit(1);
  }

  // Everything already imported for this state, so a re-run updates in place.
  // One read up front beats one lookup per row by a wide margin, and on a fresh
  // database it costs nothing because there is nothing to read.
  const existing = new Map<string, string>();
  for (const lead of await repos.leads.list({ state: args.state, limit: 1_000_000 })) {
    if (lead.externalId) existing.set(lead.externalId, lead.id);
  }
  console.log(`${existing.size} leads already on file for ${args.state}\n`);

  // Campaigns and jobs are created lazily, so an extract containing no
  // massage therapists does not leave an empty campaign behind.
  const campaigns = new Map<string, { campaign: Campaign; job: Job }>();
  const allCampaigns = await repos.campaigns.list();

  async function containerFor(industry: string) {
    const cached = campaigns.get(industry);
    if (cached) return cached;

    const name = `${stateName} — ${industryLabels.get(industry) ?? industry}`;
    let campaign = allCampaigns.find((c) => c.name === name) ?? null;
    if (!campaign) {
      campaign = await repos.campaigns.create({
        id: randomUUID(),
        name,
        city: stateName,
        industry,
        status: "complete",
        batchSize: 0,
        priority: 3,
        targetLeadCount: 0,
        filters: [`Imported from Overture Maps (${args.state})`],
        sourceCommand: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        startedAt: nowIso(),
        completedAt: nowIso(),
      });
    }
    const jobs = await repos.jobs.list({ campaignId: campaign.id });
    const job =
      jobs[0] ??
      (await repos.jobs.create({
        id: randomUUID(),
        campaignId: campaign.id,
        city: stateName,
        industry,
        batchId: `overture-${args.state.toLowerCase()}`,
        status: "complete",
        payload: {},
        attempts: 1,
        error: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }));

    const container = { campaign, job };
    campaigns.set(industry, container);
    return container;
  }

  const stream = readline.createInterface({
    input: fs.createReadStream(args.file),
    crlfDelay: Infinity,
  });

  // Big enough that the per-statement overhead stops mattering, small enough
  // that a failure loses a second of work rather than a minute of it.
  const BATCH_SIZE = 500;
  const batch: Lead[] = [];

  let read = 0;
  let written = 0;
  let updated = 0;
  const scores: number[] = [];
  const byIndustry = new Map<string, number>();
  const started = Date.now();

  for await (const line of stream) {
    if (!line.trim()) continue;
    read += 1;
    if (args.limit && written >= args.limit) break;

    const observation = JSON.parse(line) as OvertureObservation;
    if (observation.state !== args.state) continue;

    const { campaign, job } = await containerFor(observation.industry);
    const existingId = existing.get(observation.overtureId);
    const lead: Lead = observationToLead(observation, {
      campaignId: campaign.id,
      jobId: job.id,
      existingId,
      now: nowIso(),
    });

    const result = await scoreLead(lead, scoringConfig, reasoning);
    lead.prospectScore = result.score;
    lead.scoreBreakdown = result.breakdown;
    lead.scoreReason = result.scoreReason;
    lead.dataConfidence = result.confidence;
    lead.qualificationStatus = qualificationStatusForScore(result.score, scoringConfig);
    lead.stagesCompleted = [...lead.stagesCompleted, "qualification"];
    lead.researchStatus = "ANALYZED";

    if (!args.dryRun) {
      batch.push(lead);
      if (batch.length >= BATCH_SIZE) {
        await repos.leads.upsertMany(batch);
        batch.length = 0;
      }
    }

    if (existingId) updated += 1;
    else written += 1;
    scores.push(result.score);
    byIndustry.set(observation.industry, (byIndustry.get(observation.industry) ?? 0) + 1);

    if ((written + updated) % 5000 === 0) {
      const seconds = (Date.now() - started) / 1000;
      console.log(`  ${written + updated} imported (${seconds.toFixed(0)}s)`);
    }
  }

  if (!args.dryRun && batch.length) await repos.leads.upsertMany(batch);

  const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const band = (min: number, max: number) => scores.filter((s) => s >= min && s <= max).length;

  console.log(`\nRead ${read} rows in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log(`  new leads:     ${written}`);
  console.log(`  updated leads: ${updated}`);
  console.log(`  average score: ${average.toFixed(1)}`);
  console.log(`  80+: ${band(80, 100)}   60-79: ${band(60, 79)}   40-59: ${band(40, 59)}   under 40: ${band(0, 39)}`);
  console.log(`\nBy industry:`);
  for (const [industry, count] of [...byIndustry].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(7)}  ${industryLabels.get(industry) ?? industry}`);
  }
  if (args.dryRun) console.log(`\nDRY RUN — nothing was written.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
