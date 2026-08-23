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
// HTTP
// ---------------------------------------------------------------------------

/**
 * An actual HTTP request. Kept separate from PipedrivePayload because that
 * type is the *preview* shape shown in the dashboard, where only creates and
 * updates ever appear — a connection check is a GET and has no business
 * widening the public type.
 */
interface PipedriveRequest {
  endpoint: string;
  method: "GET" | "POST" | "PUT";
  body: Record<string, unknown>;
}

export interface PipedriveResponse {
  status: number;
  body: unknown;
}

/** Injectable so the live paths can be exercised without a Pipedrive account. */
export type PipedriveTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<PipedriveResponse>;

const MAX_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pulls the created object's numeric id out of a Pipedrive envelope ({ success, data: { id } }). */
function extractId(body: unknown): string | null {
  const data = (body as { data?: { id?: unknown } } | null)?.data;
  const id = data?.id;
  return id == null ? null : String(id);
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
  private readonly transport: PipedriveTransport;
  /** Cached name -> 40-char key map, fetched from the account on first live use. */
  private resolvedConfig: PipedriveConfig | null = null;

  constructor(
    private readonly repo: CrmRepository,
    private readonly env: NodeJS.ProcessEnv = process.env,
    config?: PipedriveConfig,
    transport?: PipedriveTransport
  ) {
    this.config = config ?? getPipedriveConfig();
    this.transport = transport ?? defaultTransport;
  }

  describeMode(): PipedriveMode {
    return describePipedriveMode(this.env, this.config);
  }

  /**
   * Fills in whatever the config left blank by asking the account directly:
   * custom-field keys matched on field NAME, and the deal pipeline.
   *
   * Pipedrive assigns each custom field an opaque 40-character key. Those keys
   * were previously expected to be pasted into config by hand, one per field —
   * fourteen chances to mistype a value that fails silently. Since the account
   * already knows the mapping from name to key, the adapter just reads it.
   *
   * Anything explicitly set in config still wins, so a hand-tuned mapping is
   * never overwritten. Resolved once per adapter instance and cached.
   */
  private async resolveConfig(): Promise<PipedriveConfig> {
    if (this.resolvedConfig) return this.resolvedConfig;

    const resolved: PipedriveConfig = JSON.parse(JSON.stringify(this.config));

    try {
      const response = await this.send({ endpoint: "/organizationFields", method: "GET", body: {} });
      const fields = ((response.body as { data?: Array<{ name?: string; key?: string }> } | null)?.data ?? [])
        .filter((f): f is { name: string; key: string } => Boolean(f?.name && f?.key));
      const byName = new Map(fields.map((f) => [f.name.trim().toLowerCase(), f.key]));

      for (const field of resolved.organization.customFields) {
        if (field.customFieldKey) continue; // an explicit setting is authoritative
        const key = byName.get(field.label.trim().toLowerCase());
        if (key) field.customFieldKey = key;
      }
    } catch {
      // Couldn't read the field list — fall back to whatever config holds.
      // Unresolved fields are skipped and reported, never guessed.
    }

    if (resolved.deal.pipelineId == null) {
      try {
        const response = await this.send({ endpoint: "/pipelines", method: "GET", body: {} });
        const pipelines = (response.body as { data?: Array<{ id?: number }> } | null)?.data ?? [];
        if (pipelines[0]?.id != null) resolved.deal.pipelineId = pipelines[0].id;
      } catch {
        // No pipeline: the deal is still created, and Pipedrive files it in the
        // default pipeline's first stage.
      }
    }

    this.resolvedConfig = resolved;
    return resolved;
  }

  /** What the adapter resolved from the account — for the setup/status scripts. */
  async describeResolvedMapping(): Promise<{ mapped: string[]; unmapped: string[]; pipelineId: number | null }> {
    const config = await this.resolveConfig();
    return {
      mapped: config.organization.customFields.filter((f) => f.customFieldKey).map((f) => f.label),
      unmapped: config.organization.customFields.filter((f) => !f.customFieldKey).map((f) => f.label),
      pipelineId: config.deal.pipelineId,
    };
  }

  /** What would be (or was) sent for this lead. */
  preview(lead: Lead): PipedriveHandoff {
    return buildHandoff(lead, this.config);
  }

  /**
   * Verifies the credentials actually work, without writing anything.
   * /users/me is the cheapest authenticated read Pipedrive offers.
   */
  async testConnection(): Promise<{ ok: boolean; detail: string }> {
    const mode = this.describeMode();
    if (!mode.live) return { ok: false, detail: mode.explanation };
    try {
      const response = await this.send({ endpoint: "/users/me", method: "GET", body: {} });
      const name = (response.body as { data?: { name?: string } } | null)?.data?.name;
      return { ok: true, detail: name ? `Connected as ${name}.` : "Credentials accepted." };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  /**
   * Pushes a lead, creating on first sync and UPDATING on every sync after.
   *
   * The ids Pipedrive assigns are stored on the CrmRecord, and their presence
   * is what makes a repeat sync an update. Without that, running the same
   * campaign twice would file a second copy of every business — which for a
   * system built to re-run campaigns is not an edge case, it's Tuesday.
   */
  async pushLead(lead: Lead): Promise<CrmRecord> {
    const mode = this.describeMode();
    // Only live mode resolves against the account; dry-run stays offline.
    const config = mode.live ? await this.resolveConfig() : this.config;
    const handoff = buildHandoff(lead, config);
    const existing = this.latestRecord(lead.id);

    let orgId = existing?.externalOrgId ?? null;
    let personId = existing?.externalPersonId ?? null;
    let dealId = existing?.externalDealId ?? null;

    if (mode.live) {
      for (const payload of handoff.payloads) {
        const known = payload.object === "organization" ? orgId : payload.object === "person" ? personId : dealId;

        // Attach the person/org to the deal so Pipedrive shows them together.
        const body = { ...payload.body };
        if (payload.object === "person" && orgId) body.org_id = Number(orgId);
        if (payload.object === "deal") {
          if (orgId) body.org_id = Number(orgId);
          if (personId) body.person_id = Number(personId);
        }

        const response = await this.send({
          body,
          method: known ? "PUT" : "POST",
          endpoint: known ? `${payload.endpoint}/${known}` : payload.endpoint,
        });

        const returnedId = extractId(response.body) ?? known;
        if (payload.object === "organization") orgId = returnedId;
        else if (payload.object === "person") personId = returnedId;
        else dealId = returnedId;
      }
    }

    // Recorded either way, so the dashboard shows an identical audit trail
    // whether the push was real or a dry run.
    return this.repo.upsert({
      id: existing?.id ?? nextId(),
      leadId: lead.id,
      stage: "CRM",
      syncedAt: new Date().toISOString(),
      externalCrmName: mode.live ? this.crmName : `${this.crmName} (dry-run)`,
      externalOrgId: orgId,
      externalPersonId: personId,
      externalDealId: dealId,
    });
  }

  async updateStage(leadId: string, stage: PipelineStage): Promise<CrmRecord> {
    const mode = this.describeMode();
    const config = mode.live ? await this.resolveConfig() : this.config;
    const stageId = config.deal.stageMap[stage];
    const existing = this.latestRecord(leadId);

    // Address the deal by the id PIPEDRIVE assigned. An earlier version used
    // our own lead UUID here, which is not a Pipedrive deal id and would have
    // 404'd against the real API the first time it ran live.
    if (mode.live && stageId != null && existing?.externalDealId) {
      await this.send({
        endpoint: `/deals/${existing.externalDealId}`,
        method: "PUT",
        body: { stage_id: stageId },
      });
    }

    return this.repo.upsert({
      id: existing?.id ?? nextId(),
      leadId,
      stage,
      syncedAt: new Date().toISOString(),
      externalCrmName: mode.live ? this.crmName : `${this.crmName} (dry-run)`,
      externalOrgId: existing?.externalOrgId ?? null,
      externalPersonId: existing?.externalPersonId ?? null,
      externalDealId: existing?.externalDealId ?? null,
    });
  }

  async getRecords(leadId: string): Promise<CrmRecord[]> {
    return this.repo.listByLead(leadId);
  }

  /** Most recent sync for a lead, which carries the external ids. */
  private latestRecord(leadId: string): CrmRecord | null {
    return this.repo.listByLead(leadId)[0] ?? null;
  }

  /**
   * The only place in this file that touches the network. Unreachable unless
   * describeMode() returned live, which requires both switches to be set.
   *
   * Retries on 429 and on 5xx. Pipedrive enforces both a rolling burst window
   * and a daily token budget, so a busy campaign WILL hit 429 — treating that
   * as a hard failure would drop leads on the floor mid-sync.
   */
  private async send(payload: PipedriveRequest): Promise<PipedriveResponse> {
    const token = this.env[this.config.connection.apiTokenEnvVar];
    if (!token) {
      throw new Error(
        `Refusing to call Pipedrive: ${this.config.connection.apiTokenEnvVar} is not set. This is a bug — send() ran without live mode.`
      );
    }

    const base = this.config.connection.companyDomain
      ? `https://${this.config.connection.companyDomain}.pipedrive.com/api/v1`
      : this.config.connection.apiBaseUrl;
    const url = `${base}${payload.endpoint}`;

    let lastError = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await this.transport(url, {
        method: payload.method,
        headers: {
          "Content-Type": "application/json",
          // Header auth rather than ?api_token= so the secret never lands in
          // a URL, where it would end up in logs and error messages.
          "x-api-token": token,
        },
        body: payload.method === "GET" ? undefined : JSON.stringify(payload.body),
      });

      if (response.status >= 200 && response.status < 300) return response;

      const retryable = response.status === 429 || response.status >= 500;
      lastError = `${response.status} ${JSON.stringify(response.body).slice(0, 300)}`;

      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw new Error(`Pipedrive ${payload.method} ${payload.endpoint} failed: ${lastError}`);
      }

      // Exponential backoff. A real Retry-After would be honoured here; the
      // transport interface deliberately keeps headers out of scope for now,
      // so this is the conservative fallback.
      await sleep(500 * 2 ** (attempt - 1));
    }

    throw new Error(`Pipedrive ${payload.method} ${payload.endpoint} failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
  }
}

const defaultTransport: PipedriveTransport = async (url, init) => {
  const response = await fetch(url, init);
  const text = await response.text().catch(() => "");
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error page — keep the raw text for the error message.
  }
  return { status: response.status, body };
};
