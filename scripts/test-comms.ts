/**
 * Communications Centre test suite.
 *
 * The tests that matter most here are the ones proving something does NOT
 * happen: that nothing sends without approval, that editing after approval
 * revokes it, and that two people with the same name produce a question rather
 * than a message. Those are the failures that cannot be undone.
 *
 * Runs against a real database (SQLite locally) and stub providers, so the
 * whole path is exercised without anything leaving the machine.
 *
 *   npm run test-comms
 */
import fs from "node:fs";
import {
  CommsService,
  ContactResolver,
  RecordingEmailProvider,
  RecordingSmsProvider,
  ResendEmailProvider,
  TwilioSmsProvider,
  PipedriveReader,
  approvalFingerprint,
  composeFallback,
  describeCandidate,
  findTool,
  COMMS_TOOLS,
  type ToolContext,
  type Lead,
} from "@market-outreach/core";
import { createRepositories, closeDb, defaultDbPath } from "@market-outreach/db";

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

/** Refuses to run against anything that is not a local file. */
function resetLocalDatabase(): void {
  const url = process.env.DATABASE_URL?.trim();
  if (url && !/localhost|127\.0\.0\.1/.test(url)) {
    console.error("Refusing to run: DATABASE_URL points at a remote database.");
    process.exit(1);
  }
  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${defaultDbPath()}${suffix}`;
    if (fs.existsSync(path)) fs.unlinkSync(path);
  }
}

function stubLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1", businessName: "Academy Barber", industry: "barbers", address: "1 Main St",
    city: "Miami", state: "FL", zip: "33139", phone: "(305) 555-0101", email: "hello@academybarber.com",
    website: null, websiteStatus: "NONE", websiteQuality: "UNKNOWN", onlineBookingStatus: "UNKNOWN",
    bookingProvider: null, bookingMethod: "UNKNOWN", staffCount: null, staffCountConfidence: "LOW",
    rating: null, reviewCount: null, instagram: null, facebook: null, socialActivity: "UNKNOWN",
    locationCount: null, services: [], prospectScore: 70, scoreBreakdown: [], scoreReason: null,
    dataConfidence: "LOW", discoverySource: "test", externalId: null, sourceConfidence: null,
    latitude: null, longitude: null, websiteCheckedAt: null, analysisVersion: null, directoryCheckedAt: null,
    dateDiscovered: "2026-08-25T00:00:00.000Z",
    dateLastResearched: null, researchStatus: "ENRICHED", qualificationStatus: "QUALIFIED",
    pipelineStage: "RESEARCH", linkInBioUrl: null, detectedLinks: [], serviceArea: null,
    locationConfidence: "HIGH", locationEvidence: [], campaignId: "c1", jobId: "j1",
    isDuplicateOf: null, stagesCompleted: [], notes: "", ...overrides,
  };
}

async function main() {
  resetLocalDatabase();
  const repos = createRepositories();

  section("Providers refuse honestly when unconfigured");
  const bareEmail = new ResendEmailProvider({});
  const bareSms = new TwilioSmsProvider({});
  check("email is not ready with no key", !bareEmail.readiness().ready);
  check("it names RESEND_API_KEY", bareEmail.readiness().missing.includes("RESEND_API_KEY"));
  check("it names the from-address too", bareEmail.readiness().missing.includes("RESEND_FROM_EMAIL"));
  check(
    "and mentions domain verification, which no key can substitute for",
    bareEmail.readiness().explanation.toLowerCase().includes("dns")
  );
  check("sms is not ready with no credentials", !bareSms.readiness().ready);
  check("it names all three Twilio variables", bareSms.readiness().missing.length === 3);

  const refusedSend = await bareEmail.send({ to: "a@b.c", subject: "x", body: "y" });
  check("an unconfigured provider returns failure, not success", !refusedSend.ok);
  check("and invents no message id", refusedSend.providerMessageId === null);

  section("A provider that is configured actually builds the right request");
  let captured: { url: string; body: string; headers: Record<string, string> } | null = null;
  const spyEmail = new ResendEmailProvider(
    { RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "me@example.com" },
    async (url, init) => {
      captured = { url, body: init.body, headers: init.headers };
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: "msg_123" }) };
    }
  );
  const sent = await spyEmail.send({ to: "john@abc.com", subject: "Hello", body: "Body here" });
  check("it reports success", sent.ok);
  check("and returns the provider's real id", sent.providerMessageId === "msg_123");
  check("it posts to Resend", captured!.url === "https://api.resend.com/emails");
  check("the key travels in the header, not the body", captured!.headers.authorization === "Bearer re_test");
  check("the recipient is the one asked for", JSON.parse(captured!.body).to[0] === "john@abc.com");
  check("the key is NOT in the body", !captured!.body.includes("re_test"));

  const twilioSpy = new TwilioSmsProvider(
    { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM_NUMBER: "+15550001111" },
    async (url, init) => {
      captured = { url, body: init.body, headers: init.headers };
      return { ok: true, status: 201, text: async () => JSON.stringify({ sid: "SM999" }) };
    }
  );
  const smsSent = await twilioSpy.send({ to: "+15559998888", body: "Running late" });
  check("twilio reports success with its sid", smsSent.ok && smsSent.providerMessageId === "SM999");
  check("it posts to the account's Messages endpoint", captured!.url.includes("/Accounts/AC1/Messages.json"));
  check("credentials go in the auth header", captured!.headers.authorization.startsWith("Basic "));
  check("the token is NOT in the body", !captured!.body.includes("tok"));

  const failing = new ResendEmailProvider(
    { RESEND_API_KEY: "k", RESEND_FROM_EMAIL: "m@e.com" },
    async () => ({ ok: false, status: 422, text: async () => "domain not verified" })
  );
  const rejected = await failing.send({ to: "a@b.c", subject: "s", body: "b" });
  check("a provider rejection is reported as a failure", !rejected.ok);
  check("with the reason carried through", rejected.error?.includes("domain not verified") === true);

  section("Nothing sends without approval");
  const email = new RecordingEmailProvider();
  const sms = new RecordingSmsProvider();
  const comms = new CommsService({ repo: repos.communications, email, sms });

  const draft = await comms.draft({
    channel: "email",
    destination: "john@abc.com",
    subject: "Wednesday?",
    body: "Are you free Wednesday at 3?",
    contactName: "John Murphy",
  });
  check("a draft starts awaiting approval", draft.status === "awaiting_approval", draft.status);
  check("with no approval recorded", draft.approvedAt === null);

  const premature = await comms.send(draft.id);
  check("sending an unapproved message is refused", !premature.ok);
  check("nothing reached the provider", email.sent.length === 0);
  check("and the refusal says why", premature.refusal?.includes("approved") === true, String(premature.refusal));

  section("Approval is for the exact words, and editing revokes it");
  const fingerprintBefore = approvalFingerprint(draft);
  await comms.approve(draft.id, "owner");
  const revised = await comms.revise(draft.id, { body: "Are you free THURSDAY at 3?" });
  check("revising clears the approval", revised!.approvedAt === null);
  check("and puts it back to awaiting approval", revised!.status === "awaiting_approval");

  const staleSend = await comms.send(draft.id, { expectedFingerprint: fingerprintBefore });
  check("sending with a stale approval is refused", !staleSend.ok);
  check("still nothing reached the provider", email.sent.length === 0);

  section("An approved message sends, once");
  await comms.approve(draft.id, "owner");
  const fresh = (await repos.communications.getById(draft.id))!;
  const ok = await comms.send(fresh.id, { expectedFingerprint: approvalFingerprint(fresh) });
  check("it sends", ok.ok, String(ok.refusal));
  check("the provider got exactly one message", email.sent.length === 1, String(email.sent.length));
  check("addressed to the right person", email.sent[0].to === "john@abc.com");
  check("the record says sent", ok.communication.status === "sent");
  check("with the provider's id stored", ok.communication.providerMessageId === "rec_1");
  check("and a sent timestamp", ok.communication.sentAt !== null);

  const again = await comms.send(fresh.id);
  check("sending a second time does not send again", email.sent.length === 1, String(email.sent.length));
  check("and reports the existing success", again.ok);

  section("A cancelled draft cannot be sent");
  const doomed = await comms.draft({ channel: "sms", destination: "+15551234567", body: "hi" });
  await comms.cancel(doomed.id);
  const cancelledSend = await comms.send(doomed.id);
  check("a cancelled message is refused", !cancelledSend.ok);
  check("nothing reached the sms provider", sms.sent.length === 0);

  section("A failing provider is recorded as failed, not sent");
  const brokenEmail = new RecordingEmailProvider(false);
  const brokenComms = new CommsService({ repo: repos.communications, email: brokenEmail, sms });
  const willFail = await brokenComms.draft({
    channel: "email", destination: "x@y.z", subject: "s", body: "b",
  });
  await brokenComms.approve(willFail.id, "owner");
  const failedOutcome = await brokenComms.send(willFail.id);
  check("the outcome is a failure", !failedOutcome.ok);
  check("the record says failed", failedOutcome.communication.status === "failed");
  check("with the error kept", failedOutcome.communication.error !== null);
  check("and no sent timestamp", failedOutcome.communication.sentAt === null);

  section("Contact resolution refuses to guess");
  // Leads reference a campaign and a job, and the foreign keys are real.
  const nowIso = "2026-08-25T00:00:00.000Z";
  await repos.campaigns.create({
    id: "c1", name: "Test", city: "Miami", industry: "barbers", status: "complete",
    batchSize: 0, priority: 3, targetLeadCount: 0, filters: [], sourceCommand: null,
    createdAt: nowIso, updatedAt: nowIso, startedAt: nowIso, completedAt: nowIso,
  });
  await repos.jobs.create({
    id: "j1", campaignId: "c1", city: "Miami", industry: "barbers", batchId: "b1",
    status: "complete", payload: {}, attempts: 1, error: null, createdAt: nowIso, updatedAt: nowIso,
  });
  await repos.leads.upsert(stubLead());
  // A different phone as well as a different email: two businesses sharing a
  // number are genuinely one recipient, and the resolver is right to merge
  // them. Giving them the same number here would test the fixture, not the code.
  await repos.leads.upsert(
    stubLead({
      id: "lead-2",
      businessName: "Academy Barber Downtown",
      email: "info@academydt.com",
      phone: "(305) 555-0202",
    })
  );
  const resolver = new ContactResolver({ pipedrive: null, leads: repos.leads });

  const twoMatches = await resolver.resolve("Academy Barber", "email");
  check("two matching businesses are ambiguous", twoMatches.kind === "ambiguous", twoMatches.kind);
  if (twoMatches.kind === "ambiguous") {
    check("both are offered", twoMatches.candidates.length === 2);
    const line = describeCandidate(twoMatches.candidates[0], "email");
    check("each option shows its address", line.includes("@"));
    check("and where it came from", line.includes("Lead in Miami"));
  }

  const oneMatch = await resolver.resolve("Academy Barber Downtown", "email");
  check("an unambiguous name resolves", oneMatch.kind === "resolved", oneMatch.kind);

  const noMatch = await resolver.resolve("Nobody At All", "email");
  check("an unknown name is not found", noMatch.kind === "not_found");

  await repos.leads.upsert(
    stubLead({ id: "lead-3", businessName: "Phone Only Cuts", email: null, phone: "(305) 555-0303" })
  );
  const noEmail = await resolver.resolve("Phone Only Cuts", "email");
  check("a contact with no email is unreachable, not missing", noEmail.kind === "unreachable", noEmail.kind);
  const byPhone = await resolver.resolve("Phone Only Cuts", "sms");
  check("but the same contact resolves for sms", byPhone.kind === "resolved", byPhone.kind);

  section("Composing without a model");
  const emailBody = composeFallback({
    channel: "email", intent: "Are you free Wednesday at 3 for a 15-minute demo?",
    contactName: "John Murphy", businessName: "ABC Barbers", senderName: "Brian",
  });
  check("it greets by first name", emailBody.body.startsWith("Hi John,"), emailBody.body.slice(0, 20));
  check("the owner's words are the substance", emailBody.body.includes("Wednesday at 3"));
  check("it signs off with the owner's name", emailBody.body.includes("Brian"));
  check("it writes a subject", Boolean(emailBody.subject));
  check("and admits it is not bespoke", emailBody.bespoke === false);

  const smsBody = composeFallback({
    channel: "sms", intent: "I'm running ten minutes late.",
    contactName: "John Murphy", businessName: null, senderName: "Brian",
  });
  check("an sms has no subject", smsBody.subject === null);
  check("and no email sign-off block", !smsBody.body.includes("Thanks,"), smsBody.body);
  check("it stays within one message", smsBody.body.length <= 320);

  section("The Manager's tools, end to end");
  const ctx: ToolContext = {
    repos, manager: null as never, commandParser: null as never,
    now: () => new Date("2026-08-25T12:00:00Z"),
    conversationId: "conv-1", messageId: "msg-1", focusAgentId: null,
    comms, contacts: resolver, pipedrive: new PipedriveReader({ env: {} }), composer: null,
  };

  const draftEmailTool = findTool("draft_email")!;
  check("draft_email is registered", Boolean(draftEmailTool));
  check("and is low risk, so it never needs approval", draftEmailTool.risk === "low");

  // The property that matters is that nothing new was written, not any
  // particular absolute count — earlier sections left records behind.
  const draftsBefore = await repos.communications.count();
  const ambiguous = await draftEmailTool.run({ to: "Academy Barber", intent: "test" }, ctx);
  check("drafting to an ambiguous name asks instead", ambiguous.speech.includes("Which one"), ambiguous.speech.slice(0, 60));
  check("and drafts nothing", (await repos.communications.count()) === draftsBefore);

  const drafted = await draftEmailTool.run(
    { to: "Academy Barber Downtown", intent: "Are you free Wednesday at 3?" }, ctx
  );
  check("an unambiguous name drafts", drafted.speech.includes("drafted"), drafted.speech.slice(0, 60));
  check("the draft shows the recipient address", drafted.speech.includes("info@academydt.com"));
  check("and invites approval", drafted.speech.toLowerCase().includes("send it"));

  const sendTool = findTool("send_communication")!;
  check("send_communication is high risk", sendTool.risk === "high");

  const before = email.sent.length;
  const sendResult = await sendTool.run({}, ctx);
  check("sending the approved draft works", sendResult.speech.startsWith("Sent to"), sendResult.speech);
  check("exactly one more message went out", email.sent.length === before + 1);

  const historyTool = findTool("list_communications")!;
  const history = await historyTool.run({ limit: 10 }, ctx);
  check("history lists what happened", history.speech.includes("sent to"), history.speech.slice(0, 80));

  const crm = findTool("crm_lookup")!;
  const crmResult = await crm.run({ query: "John" }, ctx);
  check("crm_lookup says Pipedrive is not connected rather than failing",
    crmResult.speech.includes("PIPEDRIVE_API_TOKEN"), crmResult.speech.slice(0, 80));

  section("Tool risk levels match the spec");
  const risk = (name: string) => COMMS_TOOLS.find((t) => t.name === name)?.risk;
  check("draft_email is low", risk("draft_email") === "low");
  check("draft_sms is low", risk("draft_sms") === "low");
  check("revise_draft is low", risk("revise_draft") === "low");
  check("list_communications is low", risk("list_communications") === "low");
  check("crm_lookup is low", risk("crm_lookup") === "low");
  check("send_communication is high", risk("send_communication") === "high");
  check("no comms tool is medium — sending is high or it is a read",
    COMMS_TOOLS.every((t) => t.risk === "low" || t.risk === "high"));

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
