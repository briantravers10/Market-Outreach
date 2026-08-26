/**
 * Bulk CRM push test suite.
 *
 * Offline and in-memory: fake repositories and a recording adapter, so nothing
 * here touches a database or a network. The properties under test are the ones
 * that cost real money to get wrong — filing a business twice in somebody's
 * CRM, or pushing when the caller asked for a preview.
 *
 *   npm run test-bulk-push
 */
import {
  bulkPushToCrm,
  describeBulkPush,
  type CrmAdapter,
  type CrmRecord,
  type CrmRepository,
  type Lead,
  type LeadFilter,
  type LeadsRepository,
  type PipelineStage,
  type QualificationStatus,
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

let leadCounter = 0;
function makeLead(overrides: Partial<Lead> = {}): Lead {
  leadCounter += 1;
  return {
    id: `lead_${leadCounter}`,
    campaignId: "camp_1",
    jobId: "job_1",
    externalId: `ext_${leadCounter}`,
    businessName: `Business ${leadCounter}`,
    industry: "barbershops",
    address: `${leadCounter} Main St`,
    city: "Miami",
    state: "FL",
    zip: "33101",
    phone: "3055550100",
    email: `owner${leadCounter}@example.com`,
    website: "https://example.com",
    prospectScore: 50,
    qualificationStatus: "QUALIFIED" as QualificationStatus,
    pipelineStage: "QUALIFIED" as PipelineStage,
    isDuplicateOf: null,
    ...overrides,
  } as Lead;
}

/** Only the parts of the leads repository bulkPushToCrm actually uses. */
function fakeLeads(rows: Lead[]): LeadsRepository {
  return {
    async list(filter?: LeadFilter): Promise<Lead[]> {
      let out = rows;
      if (filter?.qualificationStatus) out = out.filter((l) => l.qualificationStatus === filter.qualificationStatus);
      // The filter speaks in booleans; a lead carries a reference to what it
      // was folded into. Translating here is exactly what the SQL does.
      if (filter?.isDuplicate !== undefined) {
        out = out.filter((l) => (l.isDuplicateOf !== null) === filter.isDuplicate);
      }
      if (filter?.minScore !== undefined) out = out.filter((l) => (l.prospectScore ?? 0) >= filter.minScore!);
      if (filter?.state) out = out.filter((l) => l.state === filter.state);
      if (filter?.city) out = out.filter((l) => l.city === filter.city);
      if (filter?.industry) out = out.filter((l) => l.industry === filter.industry);
      return out.slice(0, filter?.limit ?? out.length);
    },
  } as unknown as LeadsRepository;
}

function fakeCrmRepo(syncedIds: string[] = []): CrmRepository & { records: CrmRecord[] } {
  const records: CrmRecord[] = [];
  return {
    records,
    async upsert(record: CrmRecord) {
      records.push(record);
      return record;
    },
    async listByLead(leadId: string) {
      return records.filter((r) => r.leadId === leadId);
    },
    async list() {
      return records;
    },
    async syncedLeadIds() {
      return syncedIds;
    },
  };
}

/** Records what it was asked to push; optionally fails for named businesses. */
function recordingAdapter(failFor: string[] = []): CrmAdapter & { pushedIds: string[] } {
  const pushedIds: string[] = [];
  return {
    crmName: "recording",
    pushedIds,
    async pushLead(lead: Lead) {
      if (failFor.includes(lead.businessName)) throw new Error(`Pipedrive rejected ${lead.businessName}`);
      pushedIds.push(lead.id);
      return { id: `rec_${lead.id}`, leadId: lead.id, stage: "CRM" } as CrmRecord;
    },
    async updateStage() {
      throw new Error("not used");
    },
    async getRecords() {
      return [];
    },
  };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  section("Dry run is the default");
  // ---------------------------------------------------------------------------

  {
    const leads = [makeLead(), makeLead(), makeLead()];
    const adapter = recordingAdapter();
    const result = await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: fakeCrmRepo(), adapter },
      { limit: 100 }
    );
    check("omitting dryRun previews rather than pushes", result.dryRun === true);
    check("a dry run pushes nothing to the adapter", adapter.pushedIds.length === 0);
    check("a dry run reports zero pushed", result.pushed === 0);
    check("a dry run still counts what is eligible", result.eligible === 3, `got ${result.eligible}`);
    check("a dry run still produces a preview", result.preview.length === 3);
    check(
      "the preview names the objects that would be created",
      result.preview[0].objects.includes("organization")
    );
  }

  // ---------------------------------------------------------------------------
  section("Never file the same business twice");
  // ---------------------------------------------------------------------------

  {
    const leads = [makeLead(), makeLead(), makeLead()];
    const alreadyThere = [leads[0].id, leads[1].id];
    const adapter = recordingAdapter();
    const result = await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: fakeCrmRepo(alreadyThere), adapter },
      { limit: 100, dryRun: false }
    );
    check("already-synced leads are excluded", result.pushed === 1, `pushed ${result.pushed}`);
    check("the skipped ones are counted and reported", result.alreadySynced === 2);
    check("only the unsynced lead reached the adapter", adapter.pushedIds.length === 1);
    check("and it was the right one", adapter.pushedIds[0] === leads[2].id);
  }

  {
    // Running twice in a row must be a no-op the second time.
    const leads = [makeLead(), makeLead()];
    const repo = fakeCrmRepo();
    const adapter = recordingAdapter();
    const deps = { leads: fakeLeads(leads), crm: repo, adapter };

    await bulkPushToCrm(deps, { limit: 100, dryRun: false });
    const firstRunPushes = adapter.pushedIds.length;

    // Second run sees the first run's records.
    const repo2 = fakeCrmRepo(adapter.pushedIds);
    const adapter2 = recordingAdapter();
    const second = await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: repo2, adapter: adapter2 },
      { limit: 100, dryRun: false }
    );
    check("the first run pushes everything", firstRunPushes === 2);
    check("an immediate second run pushes nothing", second.pushed === 0, `pushed ${second.pushed}`);
    check("the second run says everything is already filed", second.eligible === 0);
    check(
      "and describes it as nothing to do",
      describeBulkPush(second).includes("already in the CRM"),
      describeBulkPush(second)
    );
  }

  // ---------------------------------------------------------------------------
  section("Bounded and resumable");
  // ---------------------------------------------------------------------------

  {
    const leads = Array.from({ length: 10 }, () => makeLead());
    const adapter = recordingAdapter();
    const result = await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: fakeCrmRepo(), adapter },
      { limit: 4, dryRun: false }
    );
    check("the limit is respected", result.pushed === 4, `pushed ${result.pushed}`);
    check("the adapter saw exactly the limit", adapter.pushedIds.length === 4);
    check("what was not reached is reported", result.remaining === 6, `remaining ${result.remaining}`);
    check(
      "the summary tells you to run it again",
      describeBulkPush(result).includes("run it again"),
      describeBulkPush(result)
    );
  }

  {
    const leads = Array.from({ length: 5 }, () => makeLead());
    const adapter = recordingAdapter();
    const result = await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: fakeCrmRepo(), adapter },
      { limit: 0, dryRun: false }
    );
    check("a zero limit pushes nothing", result.pushed === 0 && adapter.pushedIds.length === 0);
  }

  {
    // Highest score first, so a capped run takes the best leads.
    const leads = [
      makeLead({ prospectScore: 10, businessName: "Low" }),
      makeLead({ prospectScore: 90, businessName: "High" }),
      makeLead({ prospectScore: 50, businessName: "Mid" }),
    ];
    const result = await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: fakeCrmRepo(), adapter: recordingAdapter() },
      { limit: 1 }
    );
    check("a capped run takes the best-scoring lead", result.preview[0].businessName === "High");
  }

  {
    // An unscored lead must sort last, not among the genuine zeroes.
    const leads = [
      makeLead({ prospectScore: null as unknown as number, businessName: "Unscored" }),
      makeLead({ prospectScore: 0, businessName: "Zero" }),
    ];
    const result = await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: fakeCrmRepo(), adapter: recordingAdapter() },
      { limit: 2 }
    );
    check("a scored zero outranks an unscored lead", result.preview[0].businessName === "Zero");
    check("an unscored lead reports a null score, not a zero", result.preview[1].score === null);
  }

  // ---------------------------------------------------------------------------
  section("One bad record does not abandon the rest");
  // ---------------------------------------------------------------------------

  {
    const leads = [
      makeLead({ businessName: "Good One" }),
      makeLead({ businessName: "Explodes" }),
      makeLead({ businessName: "Good Two" }),
    ];
    const adapter = recordingAdapter(["Explodes"]);
    const result = await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: fakeCrmRepo(), adapter },
      { limit: 100, dryRun: false }
    );
    check("the run continues past a failure", result.pushed === 2, `pushed ${result.pushed}`);
    check("the failure is recorded", result.failures.length === 1);
    check("the failure names the business", result.failures[0].businessName === "Explodes");
    check("the failure carries the reason", result.failures[0].error.includes("rejected"));
    check("the summary mentions failures", describeBulkPush(result).includes("failed"));
  }

  // ---------------------------------------------------------------------------
  section("Selection");
  // ---------------------------------------------------------------------------

  {
    const leads = [
      makeLead({ qualificationStatus: "QUALIFIED" as QualificationStatus }),
      makeLead({ qualificationStatus: "HIGH_PRIORITY" as QualificationStatus }),
      makeLead({ qualificationStatus: "DISQUALIFIED" as QualificationStatus }),
      makeLead({ qualificationStatus: "PENDING" as QualificationStatus }),
    ];
    const result = await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: fakeCrmRepo(), adapter: recordingAdapter() },
      { limit: 100 }
    );
    check(
      "only qualified and high-priority leads are eligible by default",
      result.eligible === 2,
      `eligible ${result.eligible}`
    );
  }

  {
    const leads = [
      makeLead({ isDuplicateOf: "folded-into-this-one" }),
      makeLead({ isDuplicateOf: null }),
    ];
    const result = await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: fakeCrmRepo(), adapter: recordingAdapter() },
      { limit: 100 }
    );
    check("duplicates are never pushed", result.eligible === 1, `eligible ${result.eligible}`);
  }

  {
    const leads = [makeLead({ prospectScore: 20 }), makeLead({ prospectScore: 80 })];
    const result = await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: fakeCrmRepo(), adapter: recordingAdapter() },
      { limit: 100, filter: { minScore: 50 } }
    );
    check("a minimum score filter is applied", result.eligible === 1, `eligible ${result.eligible}`);
  }

  {
    const leads = [makeLead({ state: "FL" }), makeLead({ state: "GA" })];
    const result = await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: fakeCrmRepo(), adapter: recordingAdapter() },
      { limit: 100, filter: { state: "GA" } }
    );
    check("a state filter is applied", result.eligible === 1, `eligible ${result.eligible}`);
  }

  {
    const result = await bulkPushToCrm(
      { leads: fakeLeads([]), crm: fakeCrmRepo(), adapter: recordingAdapter() },
      { limit: 100 }
    );
    check("no matching leads is stated plainly", describeBulkPush(result).includes("No leads match"));
  }

  // ---------------------------------------------------------------------------
  section("Progress reporting");
  // ---------------------------------------------------------------------------

  {
    const leads = Array.from({ length: 5 }, () => makeLead());
    const seen: number[] = [];
    await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: fakeCrmRepo(), adapter: recordingAdapter() },
      { limit: 5, dryRun: false, onProgress: (done) => seen.push(done) }
    );
    check("progress is reported once per lead", seen.length === 5, `got ${seen.length}`);
    check("progress counts upward", seen[0] === 1 && seen[4] === 5);
  }

  {
    const leads = Array.from({ length: 3 }, () => makeLead());
    const seen: number[] = [];
    await bulkPushToCrm(
      { leads: fakeLeads(leads), crm: fakeCrmRepo(), adapter: recordingAdapter() },
      { limit: 3, dryRun: true, onProgress: (done) => seen.push(done) }
    );
    check("a dry run reports no progress, having done no work", seen.length === 0);
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
