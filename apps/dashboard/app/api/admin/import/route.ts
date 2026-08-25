import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import {
  observationToLead,
  scoreLead,
  qualificationStatusForScore,
  getScoringConfig,
  getIndustries,
  MockReasoningProvider,
  type Lead,
  type OvertureObservation,
} from "@market-outreach/core";
import { getRepos } from "../../../../lib/data";
import { isDemoMode } from "../../../../lib/demo";

/**
 * Imports a chunk of a bundled Overture extract into the lead database.
 *
 * Chunked and resumable on purpose. A statewide extract is ~77,000 businesses,
 * which no serverless invocation is going to finish inside its timeout, so the
 * caller walks it: post an offset, get back the next one, repeat. Interrupting
 * it loses nothing — the work already committed stays committed, and restarting
 * from the returned offset carries on.
 *
 * Auth: behind the session check in middleware.ts like every other route.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCES: Record<string, { file: string; state: string; stateName: string }> = {
  "overture-fl": { file: "overture-fl.ndjson.gz", state: "FL", stateName: "Florida" },
};

/** Bounded so one invocation cannot outrun its own timeout. */
const MAX_CHUNK = 4000;

function extractPath(file: string): string | null {
  // The repo root is two levels up from the dashboard in the workspace, but on
  // Vercel the traced file lands relative to the function's working directory.
  // Both are checked rather than assumed.
  const candidates = [
    path.join(process.cwd(), "data", file),
    path.join(process.cwd(), "..", "..", "data", file),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export async function POST(request: NextRequest) {
  if (isDemoMode) {
    return NextResponse.json({ error: "The demo database is a read-only snapshot." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    source?: string;
    offset?: number;
    count?: number;
  };
  const source = SOURCES[body.source ?? ""];
  if (!source) {
    return NextResponse.json(
      { error: `Unknown source. Available: ${Object.keys(SOURCES).join(", ")}` },
      { status: 400 }
    );
  }

  const filePath = extractPath(source.file);
  if (!filePath) {
    return NextResponse.json({ error: `Extract ${source.file} is not deployed with this build.` }, { status: 500 });
  }

  const offset = Math.max(0, Math.floor(body.offset ?? 0));
  const count = Math.min(MAX_CHUNK, Math.max(1, Math.floor(body.count ?? 2000)));

  const repos = getRepos();
  const scoringConfig = getScoringConfig();
  const reasoning = new MockReasoningProvider();
  const industryLabels = new Map(getIndustries().map((i) => [i.id, i.label]));

  // No pre-read of existing leads. The database resolves a re-import by
  // conflicting on the source id, which is what keeps the last chunk of a
  // state as cheap as the first — loading every existing lead per chunk made
  // the import quadratic and would have crawled by the end.
  const campaigns = await repos.campaigns.list();
  const containers = new Map<string, { campaignId: string; jobId: string }>();

  async function containerFor(industry: string) {
    const cached = containers.get(industry);
    if (cached) return cached;
    const name = `${source.stateName} — ${industryLabels.get(industry) ?? industry}`;
    const now = new Date().toISOString();
    let campaign = campaigns.find((c) => c.name === name) ?? null;
    if (!campaign) {
      campaign = await repos.campaigns.create({
        id: randomUUID(),
        name,
        city: source.stateName,
        industry,
        status: "complete",
        batchSize: 0,
        priority: 3,
        targetLeadCount: 0,
        filters: [`Imported from Overture Maps (${source.state})`],
        sourceCommand: null,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        completedAt: now,
      });
      campaigns.push(campaign);
    }
    const jobs = await repos.jobs.list({ campaignId: campaign.id });
    const job =
      jobs[0] ??
      (await repos.jobs.create({
        id: randomUUID(),
        campaignId: campaign.id,
        city: source.stateName,
        industry,
        batchId: `overture-${source.state.toLowerCase()}`,
        status: "complete",
        payload: {},
        attempts: 1,
        error: null,
        createdAt: now,
        updatedAt: now,
      }));
    const container = { campaignId: campaign.id, jobId: job.id };
    containers.set(industry, container);
    return container;
  }

  const stream = readline.createInterface({
    input: fs.createReadStream(filePath).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });

  const batch: Lead[] = [];
  let lineNumber = 0;
  let imported = 0;
  let reachedEnd = true;

  for await (const line of stream) {
    // Seeking by re-reading is not as wasteful as it looks: decompressing and
    // skipping lines is far cheaper than the database round trips, and it keeps
    // the extract a plain file rather than something needing an index.
    if (lineNumber++ < offset) continue;
    if (imported >= count) {
      reachedEnd = false;
      break;
    }
    if (!line.trim()) continue;

    const observation = JSON.parse(line) as OvertureObservation;
    if (observation.state !== source.state) continue;

    const { campaignId, jobId } = await containerFor(observation.industry);
    const now = new Date().toISOString();
    const lead = observationToLead(observation, { campaignId, jobId, now });

    const result = await scoreLead(lead, scoringConfig, reasoning);
    lead.prospectScore = result.score;
    lead.scoreBreakdown = result.breakdown;
    lead.scoreReason = result.scoreReason;
    lead.dataConfidence = result.confidence;
    lead.qualificationStatus = qualificationStatusForScore(result.score, scoringConfig);
    lead.stagesCompleted = [...lead.stagesCompleted, "qualification"];
    lead.researchStatus = "ANALYZED";

    batch.push(lead);
    if (batch.length >= 500) {
      await repos.leads.upsertManyByExternalId(batch);
      batch.length = 0;
    }
    imported += 1;
  }
  stream.close();
  if (batch.length) await repos.leads.upsertManyByExternalId(batch);

  return NextResponse.json({
    source: body.source,
    // Insert and update are indistinguishable once the database resolves the
    // conflict, so this reports what was processed rather than pretending to
    // know which. The total below is the number that actually matters.
    processed: imported,
    nextOffset: offset + imported,
    done: reachedEnd,
    totalInDatabase: await repos.leads.count({ state: source.state }),
  });
}
