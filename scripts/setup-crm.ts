/**
 * One-command Pipedrive connection.
 *
 *   PIPEDRIVE_API_TOKEN=xxx npx tsx scripts/setup-crm.ts
 *
 * Does the tedious part of connecting a CRM:
 *   1. verifies the token
 *   2. creates the custom fields this system needs, skipping any that exist
 *   3. reads back the 40-char keys Pipedrive assigns and writes them to config
 *   4. discovers the deal pipeline and its stages, and maps them
 *
 * It is SAFE TO RE-RUN. Fields are matched by name, so a second run creates
 * nothing and simply refreshes the keys. It only ever adds — it never edits or
 * deletes an existing field, and it never touches your organizations, people,
 * or deals.
 *
 * Note this DOES write to your real Pipedrive account (creating custom field
 * definitions). It deliberately requires only PIPEDRIVE_API_TOKEN, not the
 * PIPEDRIVE_LIVE_SYNC flag — setting up the schema is a separate decision from
 * turning lead syncing on.
 *
 * Flags:
 *   --pipeline=<id>   use a specific pipeline instead of the first one
 *   --no-stages       leave the stage map alone
 *   --dry-run         show what would be created, write nothing
 */
import fs from "node:fs";
import path from "node:path";

interface PipedriveField {
  id: number;
  key: string;
  name: string;
  field_type: string;
}

interface Pipeline {
  id: number;
  name: string;
}

interface Stage {
  id: number;
  name: string;
  order_nr: number;
  pipeline_id: number;
}

// Overridable so this script can be exercised against a stub API without a
// real Pipedrive account.
const BASE = process.env.PIPEDRIVE_API_BASE?.trim() || "https://api.pipedrive.com/v1";
const token = process.env.PIPEDRIVE_API_TOKEN?.trim();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipStages = args.includes("--no-stages");
const pipelineArg = args.find((a) => a.startsWith("--pipeline="))?.split("=")[1];

function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "config", "crm-pipedrive.json"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("Could not locate the repo root.");
}

async function call<T>(endpoint: string, init?: { method: string; body: unknown }): Promise<T> {
  const response = await fetch(`${BASE}${endpoint}`, {
    method: init?.method ?? "GET",
    // Header auth so the token never appears in a URL or an error message.
    headers: { "Content-Type": "application/json", "x-api-token": token! },
    body: init ? JSON.stringify(init.body) : undefined,
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text for the error */
  }

  if (!response.ok) {
    const message = (parsed as { error?: string } | null)?.error ?? text.slice(0, 200);
    throw new Error(`${response.status} on ${endpoint}: ${message}`);
  }
  return (parsed as { data: T }).data;
}

async function main() {
  if (!token) {
    console.error("PIPEDRIVE_API_TOKEN is not set.\n");
    console.error("Get one from Pipedrive: your avatar (top right) -> Personal preferences -> API.");
    console.error("Then:  PIPEDRIVE_API_TOKEN=xxx npx tsx scripts/setup-crm.ts");
    process.exit(1);
  }

  const configPath = path.join(repoRoot(), "config", "crm-pipedrive.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  // 1. Who are we?
  const me = await call<{ name: string; company_name: string; company_domain: string }>("/users/me");
  console.log(`Connected to Pipedrive as ${me.name} (${me.company_name}).`);
  if (dryRun) console.log("DRY RUN — nothing will be created or written.\n");
  else console.log("");

  // 2. Custom fields, matched by name so re-running is a no-op.
  const existing = await call<PipedriveField[]>("/organizationFields");
  const byName = new Map(existing.map((f) => [f.name.trim().toLowerCase(), f]));

  let created = 0;
  let reused = 0;

  for (const field of config.organization.customFields) {
    const match = byName.get(field.label.trim().toLowerCase());

    if (match) {
      field.customFieldKey = match.key;
      reused++;
      console.log(`  = ${field.label.padEnd(22)} already exists (${match.field_type})`);
      continue;
    }

    if (dryRun) {
      console.log(`  + ${field.label.padEnd(22)} would create as ${field.type}`);
      created++;
      continue;
    }

    const made = await call<PipedriveField>("/organizationFields", {
      method: "POST",
      body: { name: field.label, field_type: field.type },
    });
    field.customFieldKey = made.key;
    created++;
    console.log(`  + ${field.label.padEnd(22)} created (${field.type})`);
  }

  console.log(`\nCustom fields: ${created} created, ${reused} already present.`);

  // 3. Pipeline + stages.
  if (!skipStages) {
    const pipelines = await call<Pipeline[]>("/pipelines");
    if (pipelines.length === 0) {
      console.log("\nNo deal pipelines found — skipping stage mapping.");
    } else {
      const pipeline = pipelineArg
        ? pipelines.find((p) => String(p.id) === pipelineArg)
        : pipelines[0];

      if (!pipeline) {
        console.error(`\nNo pipeline with id ${pipelineArg}. Available:`);
        for (const p of pipelines) console.error(`  ${p.id}  ${p.name}`);
        process.exit(1);
      }

      if (pipelines.length > 1 && !pipelineArg) {
        console.log(`\nUsing the first of ${pipelines.length} pipelines: "${pipeline.name}" (id ${pipeline.id}).`);
        console.log("Re-run with --pipeline=<id> to choose another:");
        for (const p of pipelines) console.log(`  ${p.id}  ${p.name}`);
      } else {
        console.log(`\nPipeline: "${pipeline.name}" (id ${pipeline.id})`);
      }

      config.deal.pipelineId = pipeline.id;

      const stages = (await call<Stage[]>(`/stages?pipeline_id=${pipeline.id}`)).sort(
        (a, b) => a.order_nr - b.order_nr
      );

      // Positional mapping: our stages onto theirs in order. This is a guess,
      // so it is printed in full rather than applied quietly — a wrong stage is
      // worse than no stage, and you can see exactly what it chose.
      const ourStages = Object.keys(config.deal.stageMap);
      console.log("\nStage mapping (CHECK THIS — mapped by position, not meaning):");
      for (let i = 0; i < ourStages.length; i++) {
        const stage = stages[i];
        config.deal.stageMap[ourStages[i]] = stage ? stage.id : null;
        console.log(
          `  ${ourStages[i].padEnd(14)} -> ${stage ? `${stage.name} (id ${stage.id})` : "no matching stage — left unmapped, will be skipped"}`
        );
      }
      if (stages.length > ourStages.length) {
        console.log(`  (${stages.length - ourStages.length} further Pipedrive stage(s) left unused)`);
      }
    }
  }

  // 4. Persist.
  if (dryRun) {
    console.log("\nDRY RUN — config/crm-pipedrive.json was not modified.");
  } else {
    config.connection.companyDomain = me.company_domain ?? config.connection.companyDomain;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`\nWrote ${configPath}`);
    console.log("\nCommit that file — the keys are account-specific but not secret.");
    console.log("\nNext:");
    console.log("  1. npm run test-crm                 verify everything resolves");
    console.log("  2. Set PIPEDRIVE_LIVE_SYNC=1        only when you want leads actually written");
  }
}

main().catch((err) => {
  console.error(`\nFailed: ${(err as Error).message}`);
  process.exit(1);
});
