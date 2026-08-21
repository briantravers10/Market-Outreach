/**
 * Checks that Pipedrive credentials work, without writing anything.
 *
 *   PIPEDRIVE_API_TOKEN=xxx PIPEDRIVE_LIVE_SYNC=1 npx tsx scripts/test-crm.ts
 *
 * Run this the moment you paste a token in, before turning live sync on for
 * a real campaign — it makes one authenticated GET and reports what it found.
 */
import { PipedriveCrmAdapter, getPipedriveConfig } from "@market-outreach/core";
import { createRepositories } from "@market-outreach/db";

async function main() {
  const config = getPipedriveConfig();
  const repos = createRepositories();
  const adapter = new PipedriveCrmAdapter(repos.crm);
  const mode = adapter.describeMode();

  console.log(`Mode: ${mode.live ? "LIVE" : "dry-run"} — ${mode.explanation}\n`);

  if (!mode.live) {
    console.log("Nothing to test until both switches are set:");
    console.log(`  ${config.connection.apiTokenEnvVar}=<your token>`);
    console.log(`  ${config.connection.liveSyncEnvVar}=1`);
    process.exit(0);
  }

  const result = await adapter.testConnection();
  console.log(result.ok ? `OK — ${result.detail}` : `FAILED — ${result.detail}`);

  const unmappedFields = config.organization.customFields.filter((f) => !f.customFieldKey);
  const unmappedStages = Object.entries(config.deal.stageMap).filter(([, id]) => id == null);

  console.log(`\nMapping status (config/crm-pipedrive.json):`);
  console.log(`  custom fields mapped: ${config.organization.customFields.length - unmappedFields.length}/${config.organization.customFields.length}`);
  if (unmappedFields.length) console.log(`    still needing a key: ${unmappedFields.map((f) => f.label).join(", ")}`);
  console.log(`  deal pipeline: ${config.deal.pipelineId ?? "not set"}`);
  console.log(`  stages mapped: ${Object.keys(config.deal.stageMap).length - unmappedStages.length}/${Object.keys(config.deal.stageMap).length}`);
  if (unmappedStages.length) console.log(`    unmapped (will be skipped, never guessed): ${unmappedStages.map(([s]) => s).join(", ")}`);

  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
