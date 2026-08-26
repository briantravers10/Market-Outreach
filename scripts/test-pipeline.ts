/**
 * Working a deal: logging calls, adding notes, moving stages.
 *
 * Offline — a fake transport records what would have been sent to Pipedrive,
 * so this proves the requests without an account or a network.
 *
 * The property that matters most here is the refusals. Every one of these
 * writes to somebody's real CRM, so each must decline clearly rather than
 * appear to work: no deal to attach to, or live sync switched off.
 *
 *   npm run test-pipeline
 */
import {
  PipedriveCrmAdapter,
  getPipedriveConfig,
  type CrmRecord,
  type CrmRepository,
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

interface Sent {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

/** Records requests instead of making them. */
function recordingTransport(sent: Sent[]) {
  return async (url: string, init: { method?: string; body?: string } = {}) => {
    sent.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    });
    return { status: 200, body: { success: true, data: { id: 999 } } };
  };
}

function repoWith(records: CrmRecord[]): CrmRepository {
  return {
    async upsert(record) {
      records.push(record);
      return record;
    },
    async listByLead(leadId) {
      return records.filter((r) => r.leadId === leadId);
    },
    async list() {
      return records;
    },
    async syncedLeadIds() {
      return [...new Set(records.map((r) => r.leadId))];
    },
  };
}

const IN_CRM: CrmRecord = {
  id: "rec-1",
  leadId: "lead-1",
  stage: "CRM",
  syncedAt: "2026-08-26T12:00:00.000Z",
  externalCrmName: "pipedrive",
  externalOrgId: "11",
  externalPersonId: "22",
  externalDealId: "33",
};

/** Env with both switches on — the only state that writes. */
const LIVE_ENV = {
  PIPEDRIVE_API_TOKEN: "test-token",
  PIPEDRIVE_LIVE_SYNC: "1",
  DATABASE_URL: "postgres://x",
} as NodeJS.ProcessEnv;

function liveAdapter(records: CrmRecord[], sent: Sent[]) {
  return new PipedriveCrmAdapter(repoWith(records), LIVE_ENV, getPipedriveConfig(), recordingTransport(sent));
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  section("Logging a call");
  // ---------------------------------------------------------------------------

  {
    const sent: Sent[] = [];
    const result = await liveAdapter([{ ...IN_CRM }], sent).logCall("lead-1", {
      subject: "Called",
      note: "Spoke to the owner, wants a callback Tuesday.",
    });

    check("the call is logged", result.logged, result.reason);
    check("one request was sent", sent.length === 1, String(sent.length));
    check("to the activities endpoint", sent[0]?.url.includes("/activities"), sent[0]?.url ?? "");
    check("as a POST", sent[0]?.method === "POST");
    check("attached to the deal", sent[0]?.body.deal_id === 33);
    check("and to the person", sent[0]?.body.person_id === 22);
    check("and to the organization", sent[0]?.body.org_id === 11);
    check("typed as a call", sent[0]?.body.type === "call");
    check(
      "marked done, because it already happened",
      sent[0]?.body.done === true,
      "an open activity would show as a task still to do"
    );
    check("the note travels with it", String(sent[0]?.body.note ?? "").includes("callback Tuesday"));
  }

  {
    // A lead that was never pushed has no deal to attach to.
    const sent: Sent[] = [];
    const result = await liveAdapter([], sent).logCall("lead-unknown", { subject: "Called" });
    check("a lead not in Pipedrive is refused", !result.logged);
    check("and told to add it first", result.reason.includes("add it first"), result.reason);
    check("nothing was sent", sent.length === 0);
  }

  {
    // Token present, live sync off — the second switch.
    const sent: Sent[] = [];
    const adapter = new PipedriveCrmAdapter(
      repoWith([{ ...IN_CRM }]),
      { PIPEDRIVE_API_TOKEN: "t", DATABASE_URL: "postgres://x" } as NodeJS.ProcessEnv,
      getPipedriveConfig(),
      recordingTransport(sent)
    );
    const result = await adapter.logCall("lead-1", { subject: "Called" });
    check("dry run refuses to log", !result.logged);
    check("and says which switch is missing", result.reason.includes("PIPEDRIVE_LIVE_SYNC"), result.reason);
    check("nothing reached Pipedrive", sent.length === 0);
  }

  // ---------------------------------------------------------------------------
  section("Adding a note");
  // ---------------------------------------------------------------------------

  {
    const sent: Sent[] = [];
    const result = await liveAdapter([{ ...IN_CRM }], sent).addNote("lead-1", "  Quoted them £99/mo.  ");
    check("the note is saved", result.logged, result.reason);
    check("to the notes endpoint", sent[0]?.url.includes("/notes"));
    check("attached to the deal", sent[0]?.body.deal_id === 33);
    check("and trimmed", sent[0]?.body.content === "Quoted them £99/mo.");
  }

  {
    const sent: Sent[] = [];
    const result = await liveAdapter([{ ...IN_CRM }], sent).addNote("lead-1", "   ");
    check("an empty note is refused rather than sent", !result.logged);
    check("nothing was sent", sent.length === 0);
  }

  // ---------------------------------------------------------------------------
  section("Moving a stage");
  // ---------------------------------------------------------------------------

  {
    const sent: Sent[] = [];
    const result = await liveAdapter([{ ...IN_CRM }], sent).moveDealToStage("lead-1", 7);
    check("the deal is moved", result.moved, result.reason);
    check("addressed by Pipedrive's deal id, not ours", sent[0]?.url.includes("/deals/33"), sent[0]?.url ?? "");
    check("as a PUT", sent[0]?.method === "PUT");
    check("to the requested stage", sent[0]?.body.stage_id === 7);
  }

  {
    const sent: Sent[] = [];
    const result = await liveAdapter([], sent).moveDealToStage("lead-unknown", 7);
    check("a lead not in Pipedrive cannot be moved", !result.moved);
    check("nothing was sent", sent.length === 0);
  }

  // ---------------------------------------------------------------------------
  section("The token never appears in a URL");
  // ---------------------------------------------------------------------------

  {
    const sent: Sent[] = [];
    const records = [{ ...IN_CRM }];
    const adapter = liveAdapter(records, sent);
    await adapter.logCall("lead-1", { subject: "Called" });
    await adapter.addNote("lead-1", "note");
    await adapter.moveDealToStage("lead-1", 2);
    check(
      "no request URL carries the API token",
      sent.every((s) => !s.url.includes("test-token")),
      sent.map((s) => s.url).join(" ")
    );
    check("three requests in total", sent.length === 3, String(sent.length));
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\nFailures:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
