/**
 * Gives the public demo some Manager history to show.
 *
 * Everything here is produced by actually running the AiManager against the
 * demo database — real conversations, real instructions, a real archived
 * report. Nothing is hand-written into the tables, because a demo that shows
 * rows the code could never have produced is a lie about what the code does.
 *
 *   SEED_DB_PATH=data/demo.db npx tsx scripts/seed-manager-demo.ts
 */
import {
  AiManager,
  RuleBasedManagerBrain,
  DeterministicCommandParser,
  MockDiscoveryProvider,
  MockEnrichmentProvider,
  MockReasoningProvider,
  PipedriveCrmAdapter,
  ProspectingManager,
  generateReport,
  getScoringConfig,
  getTerritories,
  yesterday,
  today,
} from "@market-outreach/core";
import { createRepositories } from "@market-outreach/db";

async function main() {
  const repos = createRepositories();
  const prospecting = new ProspectingManager({
    repos,
    discovery: new MockDiscoveryProvider(),
    enrichment: new MockEnrichmentProvider(),
    reasoning: new MockReasoningProvider(),
    crm: new PipedriveCrmAdapter(repos.crm),
    scoringConfig: getScoringConfig(),
    territories: getTerritories(),
  });
  const ai = new AiManager({
    repos,
    brain: new RuleBasedManagerBrain(),
    manager: prospecting,
    commandParser: new DeterministicCommandParser(),
  });

  // A short session that exercises each shape the demo should show: a
  // read-only question, an instruction that gets approved, and a briefing.
  await ai.handle("what is everyone doing");

  const chains = await ai.handle("tell the Scout to stop including national chains from now on");
  if (chains.pendingAction) await ai.approve(chains.pendingAction.id);

  const scoring = await ai.handle(
    "tell the Qualifier that businesses with broken booking links should score higher, from now on"
  );
  if (scoring.pendingAction) await ai.approve(scoring.pendingAction.id);

  await ai.handle("show me the best leads");
  await ai.handle("what permanent instructions have I given the Scout");
  await ai.handle("give me my briefing");

  // One archived report of each kind, so the archive isn't empty.
  const now = new Date();
  await generateReport(repos, { type: "daily", period: yesterday(now), now });
  await generateReport(repos, { type: "daily", period: today(now), now });

  const [instructions, reports, messages] = await Promise.all([
    repos.instructions.list({}),
    repos.reports.list({}),
    repos.conversations.searchMessages({ limit: 500 }),
  ]);
  console.log(
    `Manager demo data: ${messages.length} messages, ${instructions.length} instructions, ${reports.length} reports.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
