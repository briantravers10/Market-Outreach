/**
 * CSV export test suite.
 *
 * Read-only: it builds leads in memory and checks the text that comes out, so
 * it is safe to run against any database (it touches none).
 *
 * The interesting cases are the ones a spreadsheet gets wrong quietly — commas
 * and quotes inside a business name, newlines inside notes, and formula
 * injection — so those get parsed back out of the CSV rather than eyeballed.
 *
 *   npm run test-export
 */
import { leadsToCsv, csvField, csvFilename, CSV_BOM, findLeadPreset, LEAD_PRESETS, type Lead } from "@market-outreach/core";

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

/**
 * A minimal RFC-4180 reader. Written here rather than imported so the test
 * checks the file against the standard, not against the writer's own idea of it.
 */
function parseCsv(text: string): string[][] {
  const body = text.startsWith(CSV_BOM) ? text.slice(CSV_BOM.length) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\r" && body[i + 1] === "\n") {
      row.push(field); field = ""; rows.push(row); row = []; i++; continue;
    }
    field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    businessName: "Fade Room",
    industry: "barbershops",
    address: "12 Ocean Dr",
    city: "Miami",
    state: "FL",
    zip: "33139",
    phone: "305-555-0101",
    email: null,
    website: null,
    websiteStatus: "NONE",
    websiteQuality: "NONE",
    onlineBookingStatus: "NONE",
    bookingProvider: null,
    bookingMethod: "PHONE_ONLY",
    staffCount: 4,
    staffCountConfidence: "MEDIUM",
    rating: 4.7,
    reviewCount: 132,
    instagram: "@faderoom",
    facebook: null,
    socialActivity: "ACTIVE",
    locationCount: 1,
    services: ["Haircut", "Beard trim"],
    prospectScore: 87,
    scoreBreakdown: [],
    scoreReason: "No website, no online booking, strong reviews",
    dataConfidence: "HIGH",
    discoverySource: "mock",
    dateDiscovered: "2026-08-24T10:00:00.000Z",
    dateLastResearched: "2026-08-24T10:05:00.000Z",
    researchStatus: "COMPLETE",
    qualificationStatus: "HIGH_PRIORITY",
    pipelineStage: "QUALIFIED",
    linkInBioUrl: null,
    detectedLinks: [],
    serviceArea: null,
    locationConfidence: "HIGH",
    locationEvidence: [],
    campaignId: "camp-1",
    jobId: "job-1",
    isDuplicateOf: null,
    stagesCompleted: ["discovery", "enrichment"],
    notes: "",
    ...overrides,
  } as Lead;
}

section("Field escaping");
check("plain text is not quoted", csvField("Fade Room") === "Fade Room");
check("empty for null", csvField(null) === "");
check("empty for undefined", csvField(undefined) === "");
check("comma forces quoting", csvField("Miami, FL") === '"Miami, FL"');
check("quote is doubled", csvField('The "Chair"') === '"The ""Chair"""');
check("newline forces quoting", csvField("line1\nline2") === '"line1\nline2"');
check("leading space is preserved by quoting", csvField(" padded") === '" padded"');
check("numbers pass through", csvField(87) === "87");
check("negative numbers are left alone", csvField("-5") === "-5", csvField("-5"));

section("Formula injection");
check("= is neutralised", csvField("=1+1") === "'=1+1", csvField("=1+1"));
check("+ is neutralised", csvField("+44 20 7946") === "'+44 20 7946", csvField("+44 20 7946"));
check("@ is neutralised", csvField("@SUM(A1)") === "'@SUM(A1)");
check("hyphen formula is neutralised", csvField("-2+3+cmd|' /C calc'!A0") === "'-2+3+cmd|' /C calc'!A0");
check(
  "HYPERLINK payload cannot survive as a formula",
  !parseCsv(leadsToCsv([makeLead({ businessName: '=HYPERLINK("http://evil","click")' })]))[1][0].startsWith("=")
);

section("File shape");
const csv = leadsToCsv([makeLead(), makeLead({ id: "lead-2", businessName: "Gloss & Co, Miami" })]);
const rows = parseCsv(csv);
check("starts with a UTF-8 BOM so Excel reads accents correctly", csv.startsWith(CSV_BOM));
check("uses CRLF line endings", csv.includes("\r\n"));
check("has a header plus one row per lead", rows.length === 3, `got ${rows.length}`);
check("every row has the same width as the header", rows.every((r) => r.length === rows[0].length));
check("header starts with Business Name", rows[0][0] === "Business Name");
check("a name containing a comma survives the round trip", rows[2][0] === "Gloss & Co, Miami", rows[2][0]);
check("empty export still emits the header", parseCsv(leadsToCsv([])).length === 1);

section("Values");
const header = rows[0];
const row = rows[1];
const cell = (name: string) => row[header.indexOf(name)];
check("score is the raw number", cell("Score") === "87", cell("Score"));
check("industry uses the label when one is supplied",
  parseCsv(leadsToCsv([makeLead()], { industryLabel: () => "Barbershops" }))[1][1] === "Barbershops");
check("industry falls back to the id", cell("Industry") === "barbershops", cell("Industry"));
check("enums are readable, not SHOUTED", cell("Qualification") === "high priority", cell("Qualification"));
check("services are joined", cell("Services") === "Haircut; Beard trim", cell("Services"));
check("null becomes blank, not the word null", cell("Email") === "", cell("Email"));
check("score reason is carried so a row can be judged on its own", cell("Why This Score")?.includes("No website"));
check("lead id is present so a row links back to the app", cell("Lead ID") === "lead-1");
check("notes with a newline stay one row",
  parseCsv(leadsToCsv([makeLead({ notes: "Called\nno answer" })])).length === 2);

section("Filenames");
check("date-stamped", csvFilename("leads", new Date("2026-08-25T12:00:00Z")) === "leads-2026-08-25.csv",
  csvFilename("leads", new Date("2026-08-25T12:00:00Z")));

section("Shared presets");
check("presets are shared, not duplicated", LEAD_PRESETS.length === 5, `${LEAD_PRESETS.length}`);
check("a known preset resolves", findLeadPreset("no-website-no-booking")?.label === "No website + no booking");
check("an unknown preset resolves to nothing", findLeadPreset("nope") === undefined);
check("an absent preset resolves to nothing", findLeadPreset(undefined) === undefined);
check("preset filters the same way the page does",
  findLeadPreset("staff-phone-only")!.test(makeLead()) === true);
check("preset rejects a lead that does not match",
  findLeadPreset("staff-phone-only")!.test(makeLead({ staffCount: 1 })) === false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log(`Failures:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
