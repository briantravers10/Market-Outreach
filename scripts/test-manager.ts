/**
 * AI Manager test suite.
 *
 * Runs against a real database (SQLite by default, or Postgres if DATABASE_URL
 * is set) and exercises the Manager end to end: conversation storage, tool
 * execution, instruction effects actually changing pipeline behaviour, the
 * approval gate, reporting, and scheduling.
 *
 * Deliberately checks *consequences* rather than return values wherever it can
 * — e.g. the chain-exclusion test runs the real pipeline twice and compares
 * what ended up in the leads table, rather than trusting a filter function.
 *
 *   npm run test-manager
 */

import { randomUUID } from "node:crypto";
import {
  AiManager,
  RuleBasedManagerBrain,
  ClaudeManagerBrain,
  DeterministicCommandParser,
  MockDiscoveryProvider,
  MockEnrichmentProvider,
  MockReasoningProvider,
  PipedriveCrmAdapter,
  ProspectingManager,
  applyDiscoveryInstructions,
  parseInstructionEffect,
  parseSchedule,
  parsePeriod,
  nextRunAt,
  looksLikeChain,
  generateReport,
  yesterday,
  today,
  toolsForApi,
  buildSystemPrompt,
  numbersAreGrounded,
  findTool,
  getScoringConfig,
  getTerritories,
  type AnthropicResponse,
  type Repositories,
} from "@market-outreach/core";
import { createRepositories } from "@market-outreach/db";
import fs from "node:fs";
import { closeDb, defaultDbPath } from "@market-outreach/db";

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

function buildManager(repos: Repositories) {
  return new ProspectingManager({
    repos,
    discovery: new MockDiscoveryProvider(),
    enrichment: new MockEnrichmentProvider(),
    reasoning: new MockReasoningProvider(),
    crm: new PipedriveCrmAdapter(repos.crm),
    scoringConfig: getScoringConfig(),
    territories: getTerritories(),
  });
}

/**
 * Starts from a clean database so counts are exact.
 *
 * Refuses to run against a remote Postgres: this suite writes campaigns,
 * instructions and reports, and wiping a real deployment's data because someone
 * had DATABASE_URL exported is not a recoverable mistake.
 */
function resetLocalDatabase(): void {
  const url = process.env.DATABASE_URL?.trim();
  if (url && !/localhost|127\.0\.0\.1/.test(url)) {
    console.error("Refusing to run: DATABASE_URL points at a remote database.");
    console.error("This suite creates and deletes data. Unset DATABASE_URL to test against local SQLite.");
    process.exit(1);
  }
  closeDb();
  const dbPath = defaultDbPath();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

async function main() {
  resetLocalDatabase();
  const repos = createRepositories();
  const prospecting = buildManager(repos);
  const ai = new AiManager({
    repos,
    brain: new RuleBasedManagerBrain(),
    manager: prospecting,
    commandParser: new DeterministicCommandParser(),
  });

  // =========================================================================
  section("1. Period parsing");
  // =========================================================================
  const now = new Date("2026-08-20T14:00:00Z"); // a Thursday
  check("'yesterday' resolves to a single day", (() => {
    const p = parsePeriod("what happened yesterday", now)!;
    return p !== null && new Date(p.end).getTime() - new Date(p.start).getTime() === 86_400_000;
  })());
  check("'last week' resolves to 7 days", (() => {
    const p = parsePeriod("compare with last week", now)!;
    return p !== null && Math.round((new Date(p.end).getTime() - new Date(p.start).getTime()) / 86_400_000) === 7;
  })());
  check("'three weeks ago' is further back than 'last week'", (() => {
    const a = parsePeriod("three weeks ago", now)!;
    const b = parsePeriod("last week", now)!;
    return new Date(a.start) < new Date(b.start);
  })());
  check("a sentence with no timeframe returns null", parsePeriod("show me the best leads", now) === null);
  check("'last Tuesday' lands on a Tuesday", (() => {
    const p = parsePeriod("what did I say last Tuesday", now)!;
    return new Date(p.start).getDay() === 2;
  })());

  // =========================================================================
  section("2. Schedule parsing and next-run calculation");
  // =========================================================================
  const daily = parseSchedule("every morning at 9 AM give me a progress report");
  check("daily schedule is recognized", daily?.kind === "daily_report", JSON.stringify(daily));
  check("9 AM parses to hour 9", daily?.hour === 9, String(daily?.hour));
  const weekly = parseSchedule("every Friday give me a weekly progress report");
  check("weekly schedule is recognized", weekly?.kind === "weekly_report", JSON.stringify(weekly));
  check("Friday parses to day 5", weekly?.dayOfWeek === 5, String(weekly?.dayOfWeek));
  const pm = parseSchedule("every Friday at 5pm send the report");
  check("5pm parses to hour 17", pm?.hour === 17, String(pm?.hour));
  check("a non-schedule sentence returns null", parseSchedule("give me a report") === null);
  check("next run is in the future", new Date(nextRunAt({ hour: 9, minute: 0, dayOfWeek: null }, now)) > now);
  check("weekly next run lands on the right weekday",
    new Date(nextRunAt({ hour: 9, minute: 0, dayOfWeek: 5 }, now)).getDay() === 5);

  // =========================================================================
  section("3. Instruction parsing — enforced vs advisory");
  // =========================================================================
  const cities = getTerritories().map((t) => t.city);
  const ctx = { knownCities: cities };

  const chainEffect = parseInstructionEffect("I don't want national chains anymore", ctx);
  check("chain exclusion is recognized as enforceable", chainEffect?.kind === "exclude_name_patterns", JSON.stringify(chainEffect));

  const cityEffect = parseInstructionEffect("for today's search only look at Delray Beach", ctx);
  check("city restriction is recognized", cityEffect?.kind === "restrict_cities", JSON.stringify(cityEffect));
  check("city restriction captured the right city",
    cityEffect?.kind === "restrict_cities" && cityEffect.cities.includes("Delray Beach"));

  const scoreEffect = parseInstructionEffect(
    "businesses with broken booking links should receive a higher opportunity score", ctx);
  check("score adjustment is recognized", scoreEffect?.kind === "score_adjust", JSON.stringify(scoreEffect));
  check("score adjustment is positive for 'higher'",
    scoreEffect?.kind === "score_adjust" && scoreEffect.points > 0);
  check("score adjustment picked the broken-link condition",
    scoreEffect?.kind === "score_adjust" && scoreEffect.condition === "broken_booking_link");

  const explicitPoints = parseInstructionEffect("give no online booking 20 points more, prioritize them", ctx);
  check("an explicit point value overrides the default",
    explicitPoints?.kind === "score_adjust" && Math.abs(explicitPoints.points) === 20,
    JSON.stringify(explicitPoints));

  const lowerEffect = parseInstructionEffect("deprioritize businesses with an excellent website, lower their score", ctx);
  check("'lower' produces a negative adjustment or no match",
    lowerEffect === null || (lowerEffect.kind === "score_adjust" && lowerEffect.points < 0),
    JSON.stringify(lowerEffect));

  const advisory = parseInstructionEffect("be more thorough and use your judgement", ctx);
  check("an unrecognized instruction is advisory (null), not silently enforced", advisory === null);

  check("'only chains' is NOT read as an exclusion",
    parseInstructionEffect("only look at national chains", ctx)?.kind !== "exclude_name_patterns");

  // =========================================================================
  section("4. Chain detection has no false positives on independents");
  // =========================================================================
  check("'Sunset Barber Co.' is not a chain", !looksLikeChain("Sunset Barber Co."));
  check("'Coastal Detail Co.' is not a chain", !looksLikeChain("Coastal Detail Co."));
  check("'Ocean Beauty Collective' is not a chain", !looksLikeChain("Ocean Beauty Collective"));
  check("'FadeNation' is a chain", looksLikeChain("FadeNation"));
  check("'GroomCo Express' is a chain", looksLikeChain("GroomCo Express"));
  check("'HairCo Group' is a chain", looksLikeChain("HairCo Group"));

  // =========================================================================
  section("5. Discovery filter drops the right candidates");
  // =========================================================================
  const seeds = [
    { businessName: "FadeNation", industry: "barbers", address: "1 A St", city: "Miami", state: "FL", zip: "33101", discoverySource: "t" },
    { businessName: "Sunset Barbershop", industry: "barbers", address: "2 B St", city: "Miami", state: "FL", zip: "33101", discoverySource: "t" },
    { businessName: "Elite Barber Co.", industry: "barbers", address: "3 C St", city: "Miami", state: "FL", zip: "33101", discoverySource: "t" },
  ];
  const filtered = applyDiscoveryInstructions(seeds, [chainEffect!]);
  check("the chain is dropped", filtered.dropped.some((d) => d.businessName === "FadeNation"));
  check("both independents are kept", filtered.kept.length === 2, `kept ${filtered.kept.length}`);
  check("a drop reason is recorded", filtered.dropped[0]?.reason.includes("excluded by instruction"));

  const cityFiltered = applyDiscoveryInstructions(seeds, [{ kind: "restrict_cities", cities: ["Delray Beach"] }]);
  check("city restriction drops out-of-area candidates", cityFiltered.kept.length === 0 && cityFiltered.dropped.length === 3);

  // =========================================================================
  section("6. Conversation is persisted, not remembered");
  // =========================================================================
  const turn1 = await ai.handle("what is everyone doing");
  check("the Manager replied", turn1.managerMessage.content.length > 0);
  check("the reply names real employees", /Scout|Researcher|Qualifier/.test(turn1.managerMessage.content));
  const stored = await repos.conversations.listMessages(turn1.conversation.id);
  check("both sides of the turn are stored", stored.length >= 2, `${stored.length} messages`);
  check("the owner's exact words are stored", stored.some((m) => m.role === "owner" && m.content === "what is everyone doing"));
  check("the routed intent is recorded", stored.some((m) => m.intent === "team_status"));
  check("the brain that answered is recorded", stored.some((m) => m.brain === "rule-based-v1"));

  const actionsLogged = await repos.managerActions.list({ conversationId: turn1.conversation.id });
  check("a read-only action was logged", actionsLogged.length >= 1);
  check("the read-only action ran without approval", actionsLogged[0]?.status === "succeeded", actionsLogged[0]?.status);

  // =========================================================================
  section("7. Consequential actions stop and ask");
  // =========================================================================
  const instructionTurn = await ai.handle("tell the Scout I don't want national chains anymore, from now on");
  check("a pending action was raised", instructionTurn.pendingAction !== null);
  check("nothing ran yet", instructionTurn.pendingAction?.status === "pending_approval");
  check("the Manager stated its intent before acting",
    /shall i go ahead/i.test(instructionTurn.managerMessage.content), instructionTurn.managerMessage.content);
  check("the intent names the employee and the instruction",
    /Scout/.test(instructionTurn.pendingAction?.intentSummary ?? "") &&
    /chains/i.test(instructionTurn.pendingAction?.intentSummary ?? ""));

  const beforeApproval = await repos.instructions.list({ agentId: "scout" });
  check("no instruction was written before approval", beforeApproval.length === 0, `${beforeApproval.length} found`);

  // Reject one first, to prove refusal really refuses.
  const rejectTurn = await ai.handle("tell the Qualifier to ignore reviews entirely, from now on");
  const rejected = await ai.reject(rejectTurn.pendingAction!.id);
  check("a rejected action is marked rejected", rejected?.status === "rejected");
  check("a rejected instruction was never created",
    (await repos.instructions.list({ agentId: "qualifier" })).length === 0);

  // Now approve the chain instruction.
  const approvedTurn = await ai.approve(instructionTurn.pendingAction!.id);
  check("approval produced a reply", (approvedTurn?.managerMessage.content.length ?? 0) > 0);
  const scoutInstructions = await repos.instructions.list({ agentId: "scout", status: "active" });
  check("the instruction now exists", scoutInstructions.length === 1, `${scoutInstructions.length} found`);
  check("it was stored as permanent", scoutInstructions[0]?.scope === "permanent", scoutInstructions[0]?.scope);
  check("it carries an enforceable effect", scoutInstructions[0]?.effect?.kind === "exclude_name_patterns");
  check("it links back to the conversation", scoutInstructions[0]?.conversationId === instructionTurn.conversation.id);
  check("the Manager said it would be enforced",
    /enforced/i.test(approvedTurn?.managerMessage.content ?? ""), approvedTurn?.managerMessage.content);

  const approvalRecord = await repos.managerActions.getById(instructionTurn.pendingAction!.id);
  check("the approval is on the audit record", approvalRecord?.decidedAt !== null && approvalRecord?.status === "succeeded");
  check("who approved it is recorded", approvalRecord?.decidedBy === "owner");

  // =========================================================================
  section("8. The instruction genuinely changes the pipeline");
  // =========================================================================
  // Run a campaign WITH the chain exclusion in force and confirm no chain-named
  // business is ever stored. This runs the real pipeline, not a filter helper.
  const { campaign, jobs } = await prospecting.createCampaign({
    name: "Test — Miami Barbers",
    city: "Miami",
    industry: "barbers",
    batchSize: 12,
    targetLeadCount: 36,
    priority: 1,
  });
  await prospecting.startCampaign(campaign.id);
  for (const job of jobs) {
    const fresh = await repos.jobs.getById(job.id);
    if (fresh && fresh.status === "pending") await prospecting.runJob(fresh);
  }

  const producedLeads = await repos.leads.list({ campaignId: campaign.id });
  const chainLeads = producedLeads.filter((l) => looksLikeChain(l.businessName));
  check("the campaign produced leads", producedLeads.length > 0, `${producedLeads.length} leads`);
  check("NO chain-named business was stored while the exclusion was active",
    chainLeads.length === 0, chainLeads.map((l) => l.businessName).join(", "));

  const filterActivity = await repos.agentActivity.list({ agentId: "scout", limit: 200 });
  check("the Scout logged what it excluded and why",
    filterActivity.some((a) => a.action === "discovery_filtered"),
    filterActivity.map((a) => a.action).join(", "));

  // Now revoke it and prove chains come back — otherwise the test above could
  // pass simply because the generator never produced one.
  await repos.instructions.update({ ...scoutInstructions[0], status: "revoked", revokedAt: new Date().toISOString() });
  const second = await prospecting.createCampaign({
    name: "Test — Miami Barbers 2",
    city: "Miami",
    industry: "barbers",
    batchSize: 12,
    targetLeadCount: 36,
    priority: 1,
  });
  await prospecting.startCampaign(second.campaign.id);
  for (const job of second.jobs) {
    const fresh = await repos.jobs.getById(job.id);
    if (fresh && fresh.status === "pending") await prospecting.runJob(fresh);
  }
  const secondLeads = await repos.leads.list({ campaignId: second.campaign.id });
  const secondChains = secondLeads.filter((l) => looksLikeChain(l.businessName));
  check("with the instruction revoked, chains ARE discovered again (proving the filter did the work)",
    secondChains.length > 0, `${secondChains.length} of ${secondLeads.length}`);

  // =========================================================================
  section("9. Qualifier instructions change scores visibly");
  // =========================================================================
  const scoreTurn = await ai.handle(
    "tell the Qualifier that businesses with no online booking should score higher, from now on");
  await ai.approve(scoreTurn.pendingAction!.id);
  const qualifierInstructions = await repos.instructions.list({ agentId: "qualifier", status: "active" });
  check("the Qualifier instruction was stored", qualifierInstructions.length === 1);
  check("it is enforceable", qualifierInstructions[0]?.effect?.kind === "score_adjust");

  const third = await prospecting.createCampaign({
    name: "Test — Scoring", city: "Miami", industry: "nail-salons", batchSize: 10, targetLeadCount: 20, priority: 1,
  });
  await prospecting.startCampaign(third.campaign.id);
  for (const job of third.jobs) {
    const fresh = await repos.jobs.getById(job.id);
    if (fresh && fresh.status === "pending") await prospecting.runJob(fresh);
  }
  const thirdLeads = await repos.leads.list({ campaignId: third.campaign.id });
  const adjusted = thirdLeads.filter((l) => l.scoreBreakdown.some((f) => f.id.startsWith("instruction:")));
  check("at least one lead shows the owner-instructed factor", adjusted.length > 0, `${adjusted.length} of ${thirdLeads.length}`);
  check("the instructed factor is labelled as an owner instruction",
    adjusted[0]?.scoreBreakdown.some((f) => f.category === "owner-instruction"));
  check("the score still equals the sum of its visible factors", (() => {
    const lead = adjusted[0];
    if (!lead) return false;
    const config = getScoringConfig();
    const sum = config.baseScore + lead.scoreBreakdown.reduce((t, f) => t + f.points, 0);
    const clamped = Math.max(config.scoreRange.min, Math.min(config.scoreRange.max, Math.round(sum)));
    return clamped === lead.prospectScore;
  })(), `score ${adjusted[0]?.prospectScore}`);

  // =========================================================================
  section("10. Temporary instructions expire, permanent ones don't");
  // =========================================================================
  const tempTurn = await ai.handle("for today's search only look at Delray Beach");
  check("a temporary instruction needs approval too", tempTurn.pendingAction !== null);
  await ai.approve(tempTurn.pendingAction!.id);
  const temps = await repos.instructions.list({ scope: "temporary", status: "active" });
  check("the temporary instruction was stored", temps.length >= 1);
  check("an instruction naming no employee is routed by what it does (city limit -> Scout)",
    temps.some((t) => t.agentId === "scout" && t.effect?.kind === "restrict_cities"),
    temps.map((t) => `${t.agentId}:${t.effect?.kind}`).join(", "));
  check("it has an expiry", temps[0]?.expiresAt !== null, String(temps[0]?.expiresAt));
  check("the expiry is today, not indefinite",
    temps[0]?.expiresAt ? new Date(temps[0].expiresAt).getTime() - Date.now() < 86_400_000 : false);

  const { activeInstructionsFor } = await import("@market-outreach/core");
  const expiredCheck = activeInstructionsFor(temps, { now: new Date(Date.now() + 2 * 86_400_000) });
  check("two days later it is no longer in force", expiredCheck.length === 0);
  check("but it is still on the record for auditing",
    (await repos.instructions.list({ scope: "temporary" })).length >= 1);

  // =========================================================================
  section("11. Ambiguous scope defaults to temporary");
  // =========================================================================
  const ambiguous = await ai.handle("tell the Researcher to check social media more carefully");
  check("ambiguous instruction is raised for approval", ambiguous.pendingAction !== null);
  check("ambiguous scope defaults to temporary rather than permanent",
    ambiguous.pendingAction?.params.scope === "temporary", String(ambiguous.pendingAction?.params.scope));
  await ai.approve(ambiguous.pendingAction!.id);
  const researcherInstructions = await repos.instructions.list({ agentId: "researcher" });
  check("an unrecognized instruction is stored as advisory",
    researcherInstructions[0]?.effect === null, JSON.stringify(researcherInstructions[0]?.effect));

  // =========================================================================
  section("12. Superseding: contradictory permanent rules replace, not stack");
  // =========================================================================
  // Two contradictory permanent rules of the same kind, in sequence. The second
  // must replace the first rather than both being in force.
  const ruleA = await ai.handle("tell the Scout to stop including chains from now on, permanently");
  await ai.approve(ruleA.pendingAction!.id);
  const afterA = (await repos.instructions.list({ agentId: "scout", status: "active" }))
    .filter((i) => i.effect?.kind === "exclude_name_patterns");
  check("the first exclusion rule is active", afterA.length === 1, `${afterA.length}`);

  const again = await ai.handle("tell the Scout to exclude franchises from now on, permanently");
  await ai.approve(again.pendingAction!.id);

  const scoutAll = await repos.instructions.list({ agentId: "scout" });
  const activeExclusions = scoutAll.filter((i) => i.status === "active" && i.effect?.kind === "exclude_name_patterns");
  check("only one chain-exclusion rule is active at a time",
    activeExclusions.length === 1,
    `${activeExclusions.length} active: ${activeExclusions.map((i) => i.instruction).join(" | ")}`);
  check("unrelated rules for the same employee are left alone",
    scoutAll.some((i) => i.status === "active" && i.effect?.kind === "restrict_cities"));
  check("the history is preserved rather than deleted", scoutAll.length >= 3, `${scoutAll.length} total`);

  const superseded = scoutAll.filter((i) => i.status === "superseded");
  check("the replaced rule is marked superseded, not deleted", superseded.length === 1,
    scoutAll.map((i) => i.status).join(", "));
  check("the superseded rule points at its replacement",
    superseded[0]?.supersededById === activeExclusions[0]?.id,
    `${superseded[0]?.supersededById} vs ${activeExclusions[0]?.id}`);
  check("the replacement records what it superseded",
    activeExclusions[0]?.supersedesId === superseded[0]?.id);
  check("the replacement carries a higher version number",
    (activeExclusions[0]?.version ?? 0) > (superseded[0]?.version ?? 0),
    `v${activeExclusions[0]?.version} vs v${superseded[0]?.version}`);
  check("the Manager said what it was replacing",
    /replaces an earlier rule/i.test((await repos.conversations.listMessages(again.conversation.id))
      .filter((m) => m.role === "manager").at(-1)?.content ?? ""));

  // =========================================================================
  section("13. Asking what was instructed returns real records");
  // =========================================================================
  const recall = await ai.handle("what permanent instructions have I given the Scout");
  check("the Manager quotes back the actual instruction",
    /franchise|chain/i.test(recall.managerMessage.content), recall.managerMessage.content);
  check("it distinguishes enforced from advisory",
    /enforced|advisory/i.test(recall.managerMessage.content));

  // =========================================================================
  section("14. Undo works");
  // =========================================================================
  const undo = await ai.handle("undo the permanent instruction I gave the Scout about franchises");
  if (undo.pendingAction) await ai.approve(undo.pendingAction.id);
  const afterUndo = await repos.instructions.list({ agentId: "scout", status: "active" });
  check("the franchise/chain rule is no longer active",
    !afterUndo.some((i) => /franchise|chain/i.test(i.instruction)),
    afterUndo.map((i) => i.instruction).join(" | "));
  check("undo removed only the rule asked about, not every rule",
    afterUndo.some((i) => i.effect?.kind === "restrict_cities"),
    `${afterUndo.length} still active`);
  const revokedRows = (await repos.instructions.list({ agentId: "scout" })).filter((i) => i.status === "revoked");
  check("it is marked revoked, not deleted", revokedRows.length >= 1);
  check("the revocation is timestamped", revokedRows[0]?.revokedAt !== null);

  // =========================================================================
  section("15. Reports are computed from real rows and archived");
  // =========================================================================
  const report = await generateReport(repos, { type: "daily", period: today(new Date()) });
  const actualLeadsToday = (await repos.leads.list()).filter(
    (l) => new Date(l.dateDiscovered).toDateString() === new Date().toDateString()
  ).length;
  check("the report counts match a direct query",
    report.metrics.businessesDiscovered === actualLeadsToday,
    `report ${report.metrics.businessesDiscovered} vs actual ${actualLeadsToday}`);
  check("the report was archived", (await repos.reports.getById(report.id)) !== null);
  check("the summary is non-empty prose", report.summary.length > 20);
  check("the summary's headline number matches the metrics",
    report.summary.includes(String(report.metrics.businessesDiscovered)) ||
    report.metrics.businessesDiscovered === 0);
  check("a top lead is identified when leads exist",
    report.metrics.businessesDiscovered === 0 || report.metrics.topLeads.length > 0);

  const emptyReport = await generateReport(repos, { type: "daily", period: parsePeriod("400 days ago", new Date())! });
  check("a period with no activity says so plainly",
    /nothing ran/i.test(emptyReport.summary), emptyReport.summary);
  check("an empty period reports zero, not a fabricated number", emptyReport.metrics.businessesDiscovered === 0);

  // =========================================================================
  section("16. Briefing uses live data");
  // =========================================================================
  const briefingTurn = await ai.handle("give me my briefing");
  check("the briefing greets and reports", /morning|afternoon|evening/i.test(briefingTurn.managerMessage.content));
  check("the briefing is archived as a report",
    (await repos.reports.list({ type: "briefing" })).length >= 1);
  check("the briefing mentions employee state",
    /employee|idle|working/i.test(briefingTurn.managerMessage.content), briefingTurn.managerMessage.content);

  // =========================================================================
  section("17. Scheduling is stored, not promised");
  // =========================================================================
  const schedTurn = await ai.handle("every morning at 9 AM give me a progress report covering yesterday");
  check("scheduling asks for confirmation", schedTurn.pendingAction !== null);
  await ai.approve(schedTurn.pendingAction!.id);
  const tasks = await repos.scheduledTasks.list({ active: true });
  check("the schedule row exists", tasks.length === 1, `${tasks.length} tasks`);
  check("it is a daily report at 09:00", tasks[0]?.kind === "daily_report" && tasks[0]?.hour === 9);
  check("a next run time is set", tasks[0]?.nextRunAt !== null);
  check("the owner's own words are kept", tasks[0]?.instruction.includes("every morning"));

  const weeklyTurn = await ai.handle("every Friday give me a weekly progress report");
  await ai.approve(weeklyTurn.pendingAction!.id);
  const allTasks = await repos.scheduledTasks.list({ active: true });
  check("both schedules coexist", allTasks.length === 2, `${allTasks.length}`);

  // =========================================================================
  section("18. Talking to an individual employee");
  // =========================================================================
  const talk = await ai.handle("let me talk to the Scout");
  check("focus moves to the Scout", talk.conversation.focusAgentId === "scout", String(talk.conversation.focusAgentId));
  check("the Manager hands over explicitly", /scout/i.test(talk.managerMessage.content));

  const focused = await ai.handle("you're finding too many chains, focus on independents from now on");
  check("a focused instruction routes to the Scout without naming them",
    focused.pendingAction?.agentId === "scout" ||
    (focused.pendingAction?.params.agent as string | undefined)?.includes("chain") === true ||
    focused.pendingAction !== null,
    JSON.stringify(focused.pendingAction?.params));
  if (focused.pendingAction) await ai.approve(focused.pendingAction.id);
  const scoutNow = await repos.instructions.list({ agentId: "scout", status: "active" });
  check("the instruction landed on the Scout, not the Manager", scoutNow.length >= 1, `${scoutNow.length}`);

  // =========================================================================
  section("19. Explaining a decision");
  // =========================================================================
  const someLead = (await repos.leads.list()).find((l) => l.scoreBreakdown.length > 0);
  if (someLead) {
    const why = await ai.handle(`why did the Qualifier score ${someLead.businessName} that way`);
    // Must not pass merely because the error message echoes the name back.
    check("the business was actually found",
      !/couldn'?t find/i.test(why.managerMessage.content), why.managerMessage.content.slice(0, 160));
    check("the explanation names the business and its score",
      why.managerMessage.content.includes(someLead.businessName) &&
      why.managerMessage.content.includes(String(someLead.prospectScore)),
      why.managerMessage.content.slice(0, 160));
    check("the explanation lists real scoring factors",
      someLead.scoreBreakdown.some((f) => why.managerMessage.content.includes(f.label)),
      why.managerMessage.content.slice(0, 200));
  } else {
    check("a lead with a score breakdown exists to explain", false, "no scored leads found");
  }

  // =========================================================================
  section("20. The Manager refuses to invent things");
  // =========================================================================
  const nonsense = await ai.handle("xyzzy plugh frobnicate");
  check("an unrecognized request is admitted, not guessed at",
    /didn'?t follow|not sure/i.test(nonsense.managerMessage.content), nonsense.managerMessage.content);
  check("no action was run for an unrecognized request",
    nonsense.managerMessage.toolCalls.length === 0);

  const missing = await ai.handle("why did the Qualifier reject Nonexistent Business Ltd");
  check("an unknown business is reported as not found",
    /couldn'?t find/i.test(missing.managerMessage.content), missing.managerMessage.content);

  // =========================================================================
  section("21. Claude brain: request shape and response handling (no network)");
  // =========================================================================
  const apiTools = toolsForApi();
  check("every tool is exposed to the model", apiTools.length >= 15, `${apiTools.length}`);
  check("each tool has a schema", apiTools.every((t) => t.input_schema?.type === "object"));
  check("each tool has a description", apiTools.every((t) => (t.description?.length ?? 0) > 20));
  const prompt = buildSystemPrompt(null);

  section("What the Manager is told about its own deployment");

  {
    /**
     * The bug this pins. The prompt used to assert, as a constant, that "all
     * business data in this system is synthetic test data". That was true when
     * written. By the time seventy-seven thousand real businesses with real
     * phone numbers had been imported it was an instruction to tell the owner
     * his live leads were fake — and nothing would have caught it, because a
     * prompt has no types and no tests unless someone writes them.
     */
    const live = buildSystemPrompt(null, { dataIsReal: true });
    check("a live deployment is told its businesses are real", live.includes("REAL"), "");
    check("and is forbidden from calling them test data", live.includes("Never call them samples"), "");
    check("with no leftover claim that the data is synthetic", !live.includes("synthetic"), "");

    const demo = buildSystemPrompt(null, { dataIsReal: false });
    check("the public demo is still told its data is invented", demo.includes("invented"), "");
  }

  {
    // The same shape of claim, one step ahead of it becoming false.
    const cannotSend = buildSystemPrompt(null, { canReachBusinesses: false });
    check(
      "with no provider it is told plainly that it cannot contact anyone",
      cannotSend.includes("nothing here can contact a business"),
      ""
    );
    const canSend = buildSystemPrompt(null, { canReachBusinesses: true });
    check("once a provider exists it is told sending reaches a real business", canSend.includes("reaches a real business"), "");
    check("and that approval is required first", canSend.includes("without explicit approval"), "");
    check(
      "the cautious default applies when nothing is stated",
      buildSystemPrompt(null).includes("nothing here can contact a business"),
      "an assistant that wrongly thinks it cannot send is harmless; the reverse is not"
    );
  }

  {
    const renamed = buildSystemPrompt(null, { assistantName: "Aoife" });
    check("the assistant is addressed by whatever the owner named it", renamed.startsWith("You are Aoife"), renamed.slice(0, 40));
    check("and falls back to Manager when unnamed", buildSystemPrompt(null).startsWith("You are Manager"), "");
  }

  section("How the Manager is told to speak");

  check("it is told to lead with the answer", prompt.includes("Lead with the answer"), "");
  check("it is banned from the customer-service opener", prompt.includes("How can I assist you"), "");
  check("it is told to resolve references from context", prompt.toLowerCase().includes("those leads"), "");
  check("it is told to take corrections", prompt.includes("No, I meant Florida"), "");
  check("it is told a follow-up need not repeat the question", prompt.includes("What about yesterday"), "");
  check("it is told to ask only when it genuinely cannot act", prompt.includes("only when you genuinely cannot act"), "");

  check("the system prompt forbids inventing data", /never invent/i.test(prompt));
  check("the system prompt states outreach is disabled", /outreach/i.test(prompt));
  check("the system prompt lists the real roster", /scout/i.test(prompt) && /qualifier/i.test(prompt));

  let capturedBody: any = null;
  const fakeTransport = {
    async send(body: unknown): Promise<AnthropicResponse> {
      capturedBody = body;
      return {
        content: [
          { type: "text", text: "Checking now." },
          { type: "tool_use", id: "t1", name: "get_team_status", input: {} },
        ],
      };
    },
  };
  const claudeBrain = new ClaudeManagerBrain("test-key-not-real", fakeTransport);
  const claudePlan = await claudeBrain.plan({
    text: "what's the team up to",
    history: [{ role: "owner", content: "hi" }],
    focusAgentId: null,
  });
  check("the Claude brain selects the tool the model named", claudePlan.tool?.name === "get_team_status");
  check("the model's text becomes the acknowledgement", claudePlan.acknowledgement === "Checking now.");
  check("the request includes the tool definitions", Array.isArray(capturedBody?.tools) && capturedBody.tools.length >= 15);
  check("the request includes the system prompt", typeof capturedBody?.system === "string");
  check("history is converted to API roles",
    capturedBody?.messages?.[0]?.role === "user" && capturedBody?.messages?.at(-1)?.content === "what's the team up to");

  const textOnly = claudeBrain.interpretResponse(
    { content: [{ type: "text", text: "I can't help with that." }] },
    { text: "x", history: [], focusAgentId: null }
  );
  check("a text-only response becomes a plain reply", textOnly.tool === null && textOnly.reply === "I can't help with that.");

  const badTool = claudeBrain.interpretResponse(
    { content: [{ type: "tool_use", id: "t", name: "no_such_tool", input: {} }] },
    { text: "x", history: [], focusAgentId: null }
  );
  check("a hallucinated tool name is caught, not executed",
    badTool.tool === null && badTool.intent === "unknown_tool");

  const errorBrain = new ClaudeManagerBrain("k", {
    async send() { throw new Error("401 unauthorized"); },
  });
  const errorAi = new AiManager({ repos, brain: errorBrain, manager: prospecting, commandParser: new DeterministicCommandParser() });
  const errorTurn = await errorAi.handle("give me a briefing");
  check("a brain failure is reported, not swallowed",
    /error/i.test(errorTurn.managerMessage.content), errorTurn.managerMessage.content);
  check("the owner's message survives a brain failure",
    (await repos.conversations.listMessages(errorTurn.conversation.id)).some((m) => m.content === "give me a briefing"));

  // =========================================================================
  section("22. Audit trail is queryable");
  // =========================================================================
  const allActions = await repos.managerActions.list({ limit: 500 });
  check("actions were recorded", allActions.length > 10, `${allActions.length}`);
  check("every action has a status", allActions.every((a) => a.status.length > 0));
  check("every action records what it intended to do", allActions.every((a) => a.intentSummary.length > 0));
  check("rejected actions are distinguishable", allActions.some((a) => a.status === "rejected"));
  check("approved actions record who decided",
    allActions.filter((a) => a.decidedAt).every((a) => a.decidedBy !== null));

  const managerActivity = await repos.agentActivity.list({ agentId: "manager", limit: 200 });
  check("consequential Manager work appears on the activity feed", managerActivity.length > 0, `${managerActivity.length}`);

  const allMessages = await repos.conversations.searchMessages({ limit: 500 });
  check("messages are searchable across conversations", allMessages.length > 20, `${allMessages.length}`);


  // =========================================================================
  section("23. Narration: the Manager phrases results without inventing them");
  // =========================================================================
  check("a faithful rewrite is accepted",
    numbersAreGrounded("Discovered 12 businesses, 3 high priority.",
                       "The Scout found 12 businesses yesterday, 3 of them high priority."));
  check("dropping a number is allowed",
    numbersAreGrounded("Discovered 12 businesses, 3 high priority.", "The Scout found 12 businesses."));
  check("an INVENTED number is rejected",
    !numbersAreGrounded("Discovered 12 businesses.", "The Scout found 12 businesses, up 40% on last week."));
  check("a subtly altered number is rejected",
    !numbersAreGrounded("Discovered 12 businesses.", "The Scout found 13 businesses."));
  check("word-numbers pass (the risk is confident digits)",
    numbersAreGrounded("Nothing ran yesterday.", "Nothing ran yesterday — a quiet one."));
  check("decimals are compared exactly",
    !numbersAreGrounded("Average score was 58.9.", "Average score was 58.7."));
  check("thousands separators don't cause false rejections",
    numbersAreGrounded("Processed 1,200 jobs.", "Processed 1200 jobs."));

  // The narration path itself, against a stand-in transport.
  let narrationBody: any = null;
  const narrator = new ClaudeManagerBrain("k", {
    async send(body: unknown): Promise<AnthropicResponse> {
      narrationBody = body;
      return { content: [{ type: "text", text: "Quiet day — nothing ran yesterday at all." }] };
    },
  });
  const narrated = await narrator.narrate({
    question: "give me my briefing",
    tool: "get_briefing",
    facts: "Good evening.\nNothing ran yesterday. No businesses were discovered and no jobs completed.",
  });
  check("the rewrite replaces the template", narrated === "Quiet day — nothing ran yesterday at all.", narrated);
  check("the request forbids inventing facts", /never add a number/i.test(String(narrationBody?.system)));
  check("the request carries the owner's question", JSON.stringify(narrationBody).includes("give me my briefing"));
  check("the request carries the tool's facts", JSON.stringify(narrationBody).includes("Nothing ran yesterday"));

  const liar = new ClaudeManagerBrain("k", {
    async send(): Promise<AnthropicResponse> {
      return { content: [{ type: "text", text: "Great news, 47 businesses came in overnight." }] };
    },
  });
  const guarded = await liar.narrate({ question: "briefing", tool: "get_briefing", facts: "Nothing ran yesterday." });
  check("a rewrite that invents a figure falls back to the facts",
    guarded === "Nothing ran yesterday.", guarded);

  const brokenNarrator = new ClaudeManagerBrain("k", {
    async send(): Promise<AnthropicResponse> { throw new Error("503 overloaded"); },
  });
  check("a narration failure falls back rather than losing the answer",
    (await brokenNarrator.narrate({ question: "q", tool: "t", facts: "Six leads." })) === "Six leads.");

  const emptyNarrator = new ClaudeManagerBrain("k", {
    async send(): Promise<AnthropicResponse> { return { content: [{ type: "text", text: "   " }] }; },
  });
  check("an empty rewrite falls back",
    (await emptyNarrator.narrate({ question: "q", tool: "t", facts: "Six leads." })) === "Six leads.");

  check("the rule-based brain has no narrator, so tool wording stands",
    typeof (new RuleBasedManagerBrain() as { narrate?: unknown }).narrate === "undefined");

  // =========================================================================
  section("24. Approval prompts are never rephrased");
  // =========================================================================
  const narratingAi = new AiManager({
    repos,
    brain: {
      name: "narrating-stub",
      async plan() {
        return {
          tool: findTool("give_instruction"),
          params: { agent: "scout", instruction: "Stop including chains", scope: "permanent" },
          acknowledgement: null,
          reply: null,
          intent: "give_instruction",
        } as never;
      },
      async narrate() {
        return "REWRITTEN BY THE MODEL";
      },
    },
    manager: prospecting,
    commandParser: new DeterministicCommandParser(),
  });
  const approvalTurn = await narratingAi.handle("tell the scout to stop including chains from now on");
  check("an approval prompt is raised", approvalTurn.pendingAction !== null);
  check("the approval prompt is NOT rephrased by the model",
    !approvalTurn.managerMessage.content.includes("REWRITTEN BY THE MODEL"),
    approvalTurn.managerMessage.content);
  check("the approval prompt still states exactly what will happen",
    /Scout/.test(approvalTurn.managerMessage.content) &&
    /shall i go ahead/i.test(approvalTurn.managerMessage.content),
    approvalTurn.managerMessage.content);
  if (approvalTurn.pendingAction) {
    const done = await narratingAi.approve(approvalTurn.pendingAction.id);
    check("but the RESULT afterwards is rephrased",
      done?.managerMessage.content === "REWRITTEN BY THE MODEL",
      done?.managerMessage.content);
  }

  // =========================================================================
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\nFailures:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  }
  console.log("=".repeat(60));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("\nTest suite crashed:", error);
  process.exit(1);
});
