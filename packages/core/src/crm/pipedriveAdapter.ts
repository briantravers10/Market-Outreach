import { getIndustries, getPipedriveConfig, type PipedriveConfig } from "../config";
import type { CrmAdapter } from "./crmAdapter";
import type { CrmRecord, CrmRepository, Lead, PipelineStage } from "../types";

/**
 * Pipedrive hand-off adapter.
 *
 * SAFETY MODEL — read this before changing anything here.
 *
 * This adapter has two modes and defaults to the safe one:
 *
 *   dry-run (default)  Builds the exact request payloads and records them
 *                      locally so the dashboard can show precisely what
 *                      *would* be sent. Makes zero network calls.
 *   live               Actually calls the Pipedrive REST API.
 *
 * Live mode requires BOTH an API token in the environment AND an explicit
 * opt-in flag (PIPEDRIVE_LIVE_SYNC=1). Two independent switches, because a
 * token leaking into an environment should never by itself be enough to start
 * writing to someone's real CRM. `describeMode()` reports which mode is
 * active and exactly why, so the dashboard can never misrepresent it.
 *
 * The payload builders below are pure functions exported separately from the
 * adapter. That is deliberate: the dashboard previews real hand-offs without
 * credentials, a network stack, or an adapter instance.
 */

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

export interface PipedrivePayload {
  /** Which Pipedrive object this creates. */
  object: "organization" | "person" | "deal";
  /** REST path, relative to the configured API base. */
  endpoint: string;
  method: "POST" | "PUT";
  body: Record<string, unknown>;
  /** Fields the mapping wants to send but can't yet, and why. */
  skipped: PipedriveSkippedField[];
}

export interface PipedriveSkippedField {
  leadField: string;
  label: string;
  reason: string;
}

export interface PipedriveHandoff {
  leadId: string;
  businessName: string;
  payloads: PipedrivePayload[];
  /** Human-readable reasons a payload was omitted entirely (e.g. no deal for an unqualified lead). */
  notes: string[];
}

export type PipedriveModeReason =
  | "no-token"
  | "live-sync-not-enabled"
  | "demo-read-only"
  | "live";

export interface PipedriveMode {
  live: boolean;
  reason: PipedriveModeReason;
  explanation: string;
}

// ---------------------------------------------------------------------------
// Field access + templating
// ---------------------------------------------------------------------------

function industryLabel(industryId: string): string {
  return getIndustries().find((i) => i.id === industryId)?.label ?? industryId;
}

/** Reads a Lead field by name for the config-driven mapping. */
function leadValue(lead: Lead, field: string): unknown {
  return (lead as unknown as Record<string, unknown>)[field];
}

function renderTemplate(template: string, lead: Lead): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    if (key === "industryLabel") return industryLabel(lead.industry);
    const value = leadValue(lead, key);
    return value == null ? "" : String(value);
  });
}

function isEmpty(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

// ---------------------------------------------------------------------------
// Payload builders (pure — no credentials, no network, no adapter instance)
// ---------------------------------------------------------------------------

export function buildOrganizationPayload(lead: Lead, config: PipedriveConfig): PipedrivePayload {
  const body: Record<string, unknown> = {};
  const skipped: PipedriveSkippedField[] = [];

  for (const field of config.organization.standardFields) {
    const value = leadValue(lead, field.leadField);
    if (isEmpty(value)) {
      if (field.required) {
        skipped.push({
          leadField: field.leadField,
          label: field.pipedriveField,
          reason: "Required by Pipedrive but unknown for this lead",
        });
      }
      continue;
    }
    body[field.pipedriveField] = value;
  }

  for (const field of config.organization.customFields) {
    const value = leadValue(lead, field.leadField);
    if (isEmpty(value)) {
      skipped.push({ leadField: field.leadField, label: field.label, reason: "No value researched yet" });
      continue;
    }
    if (!field.customFieldKey) {
      skipped.push({
        leadField: field.leadField,
        label: field.label,
        reason: "Awaiting Pipedrive custom-field key",
      });
      continue;
    }
    body[field.customFieldKey] = value;
  }

  return { object: "organization", endpoint: "/organizations", method: "POST", body, skipped };
}

export function buildPersonPayload(lead: Lead, config: PipedriveConfig): PipedrivePayload | null {
  // Many of the best leads in this system are exactly the businesses with no
  // web presence, so a person record is only worth creating when there is
  // actually a way to reach someone.
  if (isEmpty(lead.phone) && isEmpty(lead.email)) return null;

  const body: Record<string, unknown> = { name: renderTemplate(config.person.nameTemplate, lead) };
  const skipped: PipedriveSkippedField[] = [];

  for (const field of config.person.standardFields) {
    const value = leadValue(lead, field.leadField);
    if (isEmpty(value)) {
      skipped.push({ leadField: field.leadField, label: field.pipedriveField, reason: "Unknown for this lead" });
      continue;
    }
    // Pipedrive takes phone/email as arrays of labelled values.
    body[field.pipedriveField] = [{ value, primary: true, label: "work" }];
  }

  return { object: "person", endpoint: "/persons", method: "POST", body, skipped };
}

export function buildDealPayload(lead: Lead, config: PipedriveConfig): PipedrivePayload | null {
  if (lead.qualificationStatus !== "QUALIFIED" && lead.qualificationStatus !== "HIGH_PRIORITY") {
    return null;
  }

  const body: Record<string, unknown> = {
    title: renderTemplate(config.deal.titleTemplate, lead),
    currency: config.deal.currency,
  };
  const skipped: PipedriveSkippedField[] = [];

  if (config.deal.pipelineId != null) {
    body.pipeline_id = config.deal.pipelineId;
  } else {
    skipped.push({ leadField: "—", label: "pipeline_id", reason: "No Pipedrive pipeline selected yet" });
  }

  const stageId = config.deal.stageMap[lead.pipelineStage];
  if (stageId != null) {
    body.stage_id = stageId;
  } else {
    skipped.push({
      leadField: "pipelineStage",
      label: "stage_id",
      reason: `Internal stage ${lead.pipelineStage} is not mapped to a Pipedrive stage yet`,
    });
  }

  // Deliberately no deal value — see valueNote in config/crm-pipedrive.json.
  return { object: "deal", endpoint: "/deals", method: "POST", body, skipped };
}

/** Builds the complete hand-off for one lead. Pure — safe to call anywhere, including in the read-only demo. */
export function buildHandoff(lead: Lead, config: PipedriveConfig = getPipedriveConfig()): PipedriveHandoff {
  const payloads: PipedrivePayload[] = [buildOrganizationPayload(lead, config)];
  const notes: string[] = [];

  const person = buildPersonPayload(lead, config);
  if (person) {
    payloads.push(person);
  } else {
    notes.push("No Person record — this business has no phone or email on file, so there is nobody to attach.");
  }

  const deal = buildDealPayload(lead, config);
  if (deal) {
    payloads.push(deal);
  } else {
    notes.push(
      `No Deal record — only QUALIFIED and HIGH_PRIORITY leads open a deal, and this one is ${lead.qualificationStatus}.`
    );
  }

  return { leadId: lead.id, businessName: lead.businessName, payloads, notes };
}

/** Reports whether live sync is on, and precisely why. */
export function describePipedriveMode(
  env: NodeJS.ProcessEnv = process.env,
  config: PipedriveConfig = getPipedriveConfig()
): PipedriveMode {
  if (env.DEMO_READ_ONLY === "1") {
    return {
      live: false,
      reason: "demo-read-only",
      explanation: "Running as the public read-only demo — live CRM sync is hard-disabled regardless of credentials.",
    };
  }
  if (!env[config.connection.apiTokenEnvVar]) {
    return {
      live: false,
      reason: "no-token",
      explanation: `No ${config.connection.apiTokenEnvVar} is set, so there are no credentials to call Pipedrive with.`,
    };
  }
  if (env[config.connection.liveSyncEnvVar] !== "1") {
    return {
      live: false,
      reason: "live-sync-not-enabled",
      explanation: `A token is present but ${config.connection.liveSyncEnvVar} is not set to "1", so sync stays in dry-run.`,
    };
  }
  return { live: true, reason: "live", explanation: "Live sync is enabled — leads are written to Pipedrive." };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

let recordCounter = 0;
function nextId(): string {
  recordCounter += 1;
  return `pd_${Date.now()}_${recordCounter}`;
}

/**
 * Implements the same CrmAdapter interface as MockCrmAdapter, so swapping
 * between them is a one-line change where the manager is constructed.
 */
export class PipedriveCrmAdapter implements CrmAdapter {
  readonly crmName = "pipedrive";

  private readonly config: PipedriveConfig;

  constructor(
    private readonly repo: CrmRepository,
    private readonly env: NodeJS.ProcessEnv = process.env,
    config?: PipedriveConfig
  ) {
    this.config = config ?? getPipedriveConfig();
  }

  describeMode(): PipedriveMode {
    return describePipedriveMode(this.env, this.config);
  }

  /** What would be (or was) sent for this lead. */
  preview(lead: Lead): PipedriveHandoff {
    return buildHandoff(lead, this.config);
  }

  async pushLead(lead: Lead): Promise<CrmRecord> {
    const handoff = buildHandoff(lead, this.config);
    const mode = this.describeMode();

    if (mode.live) {
      for (const payload of handoff.payloads) {
        await this.send(payload);
      }
    }

    // Recorded either way, so the dashboard shows an identical audit trail
    // whether the push was real or a dry run.
    return this.repo.upsert({
      id: nextId(),
      leadId: lead.id,
      stage: "CRM",
      syncedAt: new Date().toISOString(),
      externalCrmName: mode.live ? this.crmName : `${this.crmName} (dry-run)`,
    });
  }

  async updateStage(leadId: string, stage: PipelineStage): Promise<CrmRecord> {
    const mode = this.describeMode();
    const stageId = this.config.deal.stageMap[stage];

    if (mode.live && stageId != null) {
      await this.send({
        object: "deal",
        endpoint: `/deals/${leadId}`,
        method: "PUT",
        body: { stage_id: stageId },
        skipped: [],
      });
    }

    return this.repo.upsert({
      id: nextId(),
      leadId,
      stage,
      syncedAt: new Date().toISOString(),
      externalCrmName: mode.live ? this.crmName : `${this.crmName} (dry-run)`,
    });
  }

  async getRecords(leadId: string): Promise<CrmRecord[]> {
    return this.repo.listByLead(leadId);
  }

  /**
   * The only place in this file that touches the network. Unreachable unless
   * describeMode() returned live, which requires both switches to be set.
   */
  private async send(payload: PipedrivePayload): Promise<unknown> {
    const token = this.env[this.config.connection.apiTokenEnvVar];
    if (!token) {
      throw new Error(
        `Refusing to call Pipedrive: ${this.config.connection.apiTokenEnvVar} is not set. This is a bug — send() ran without live mode.`
      );
    }

    const base = this.config.connection.companyDomain
      ? `https://${this.config.connection.companyDomain}.pipedrive.com/api/v1`
      : this.config.connection.apiBaseUrl;
    const url = `${base}${payload.endpoint}?api_token=${encodeURIComponent(token)}`;

    const response = await fetch(url, {
      method: payload.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload.body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<unreadable body>");
      throw new Error(`Pipedrive ${payload.method} ${payload.endpoint} failed: ${response.status} ${text}`);
    }
    return response.json();
  }
}
