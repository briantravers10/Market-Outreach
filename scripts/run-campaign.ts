import { buildOverallSummary, buildCampaignProgress } from "@market-outreach/core";
import { createRepositories } from "@market-outreach/db";
import { buildManager } from "./lib";

/**
 * CLI: drains pending jobs belonging to "running" campaigns through the full
 * DISCOVER -> ENRICH -> ANALYZE -> QUALIFY -> DEDUP -> STORE pipeline, then
 * prints a REPORT summary. Fake data only. Optional arg: --campaign=<id> to
 * limit to a single campaign.
 */
async function main() {
  const campaignArg = process.argv.find((a) => a.startsWith("--campaign="));
  const campaignId = campaignArg?.split("=")[1];

  const manager = buildManager();
  const repos = createRepositories();

  const runnableCampaigns = repos.campaigns.list().filter((c) => c.status === "running" && (!campaignId || c.id === campaignId));

  console.log(`Draining pending jobs for ${runnableCampaigns.length} running campaign(s)...`);

  let processed = 0;
  const MAX_JOBS = 500; // safety backstop for this CLI run

  for (const campaign of runnableCampaigns) {
    let pending = repos.jobs.list({ campaignId: campaign.id, status: "pending" });
    while (pending.length && processed < MAX_JOBS) {
      const job = pending[0];
      const result = await manager.runJob(job);
      processed += 1;
      console.log(
        `  [${campaign.city} | ${campaign.industry} | ${job.batchId}] -> ${result.outcome} (${result.leadsCreated} leads)`
      );
      pending = repos.jobs.list({ campaignId: campaign.id, status: "pending" });
    }
  }

  const allLeads = repos.leads.list();
  const allJobs = repos.jobs.list();
  const summary = buildOverallSummary(allLeads, allJobs);

  console.log("\n=== Campaign Report ===");
  for (const campaign of repos.campaigns.list()) {
    const progress = buildCampaignProgress(campaign, allJobs, allLeads);
    console.log(
      `${campaign.city} — ${campaign.industry} [${campaign.status}]: ${progress.completeJobs}/${progress.totalJobs} jobs complete (${progress.completionPct}%), ${progress.leadsDiscovered} leads, ${progress.leadsQualified} qualified`
    );
  }

  console.log("\n=== Overall Summary ===");
  console.log(summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
