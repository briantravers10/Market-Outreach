import { getIndustries, getTerritories } from "@market-outreach/core";
import { createRepositories } from "@market-outreach/db";
import { buildManager } from "./lib";

/**
 * Seeds fake campaigns/jobs/leads across the 3 example territories x 10
 * example industries and runs a subset of jobs so the dashboard has a
 * realistic mix of statuses to show (pending, running, complete, failed,
 * retry, human review, paused, stopped). All fake data — no real research,
 * no live discovery, nothing contacted.
 */
async function main() {
  const manager = buildManager();
  const territories = getTerritories();
  const industries = getIndustries();

  const combos: { city: string; industryId: string }[] = [];
  for (const territory of territories) {
    for (const industry of industries) {
      combos.push({ city: territory.city, industryId: industry.id });
    }
  }

  console.log(`Creating ${combos.length} campaigns (${territories.length} cities x ${industries.length} industries)...`);

  // Sequential rather than Promise.all: seeding is not performance-critical,
  // and creating campaigns in a deterministic order keeps the generated data
  // reproducible run to run.
  const campaigns: Array<Awaited<ReturnType<typeof manager.createCampaign>>> = [];
  for (const [i, { city, industryId }] of combos.entries()) {
    campaigns.push(
      await manager.createCampaign({
        name: `${city} — ${getIndustries().find((ind) => ind.id === industryId)?.label ?? industryId}`,
        city,
        industry: industryId,
        batchSize: 5,
        priority: (i % 5) + 1,
        targetLeadCount: 15, // -> 3 batches of 5 per campaign
      })
    );
  }

  let jobsRun = 0;
  let leadsCreated = 0;

  for (let i = 0; i < campaigns.length; i++) {
    const { campaign, jobs } = campaigns[i];

    // Leave roughly 40% of campaigns untouched (draft, all jobs pending) — a realistic backlog.
    if (i % 5 === 0 || i % 5 === 3) continue;

    await manager.startCampaign(campaign.id);

    if (i % 5 === 1) {
      // Fully run every job in this campaign -> demonstrates "Complete" campaigns.
      for (const job of jobs) {
        const result = await manager.runJob(job);
        jobsRun += 1;
        leadsCreated += result.leadsCreated;
      }
    } else if (i % 5 === 2) {
      // Run the first job only, then pause -> demonstrates "Paused" jobs/campaigns.
      const result = await manager.runJob(jobs[0]);
      jobsRun += 1;
      leadsCreated += result.leadsCreated;
      await manager.pauseCampaign(campaign.id);
    } else if (i % 5 === 4) {
      // Run the first job, then stop -> demonstrates "Stopped" campaigns.
      const result = await manager.runJob(jobs[0]);
      jobsRun += 1;
      leadsCreated += result.leadsCreated;
      await manager.stopCampaign(campaign.id);
    }
  }

  // Makeup Artists is the only social-first industry, and it's where the
  // link-in-bio analysis actually does its work. The i % 5 rotation above only
  // gives it ~13 leads across all cities, which is too small a sample to show
  // the distribution that matters (roughly 40% already have a booking
  // incumbent; the rest are the targets). One dedicated fully-run campaign
  // gives that signal enough volume to be legible on the dashboard.
  const showcase = await manager.createCampaign({
    name: "Miami — Makeup Artists (link-in-bio showcase)",
    city: "Miami",
    industry: "makeup-artists",
    batchSize: 6,
    priority: 5,
    targetLeadCount: 36,
  });
  await manager.startCampaign(showcase.campaign.id);
  for (const job of showcase.jobs) {
    const result = await manager.runJob(job);
    jobsRun += 1;
    leadsCreated += result.leadsCreated;
  }

  // Leave one job visibly mid-flight ("Running") for the work-queue demo, matching the
  // "Miami | Dog Groomers | Batch 001 | Running" example in the architecture spec.
  const runningDemoCampaign = campaigns.find((c) => c.campaign.city === "Miami" && c.campaign.industry === "dog-groomers");
  if (runningDemoCampaign) {
    await manager.startCampaign(runningDemoCampaign.campaign.id);
    const repos = createRepositories();
    const pendingJob = (await repos.jobs.list({ campaignId: runningDemoCampaign.campaign.id, status: "pending" }))[0];
    if (pendingJob) {
      await repos.jobs.update({ ...pendingJob, status: "running", updatedAt: new Date().toISOString() });
    }
  }

  console.log(`Seed complete: ${campaigns.length} campaigns, ${jobsRun} jobs run, ${leadsCreated} leads created.`);
  console.log("Run `npm run dashboard` to explore the fake data.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
