import { getPipedriveConfig, type PipedriveConfig } from "../config";

/**
 * Reading from Pipedrive.
 *
 * The existing adapter only ever writes — it pushes leads and updates stages.
 * This is the other half: everything the Manager needs to answer "who is John",
 * "when did we last talk to Academy Barber", "what stage is that deal at".
 *
 * Strictly read-only. There is no method here that creates, updates or deletes
 * anything, which is what lets every one of these run without asking the owner
 * first. Writes stay in pipedriveAdapter.ts where the approval gate is.
 */

export interface PipedrivePerson {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  organizationId: number | null;
  organizationName: string | null;
}

export interface PipedriveOrganization {
  id: number;
  name: string;
  address: string | null;
  ownerName: string | null;
}

export interface PipedriveDeal {
  id: number;
  title: string;
  value: number | null;
  currency: string | null;
  status: string;
  stageId: number | null;
  stageName: string | null;
  personId: number | null;
  organizationId: number | null;
  updateTime: string | null;
  expectedCloseDate: string | null;
}

export interface PipedriveActivity {
  id: number;
  subject: string;
  type: string;
  done: boolean;
  dueDate: string | null;
  personId: number | null;
  organizationId: number | null;
  dealId: number | null;
  note: string | null;
}

export interface PipedriveNote {
  id: number;
  content: string;
  addTime: string | null;
  personId: number | null;
  organizationId: number | null;
  dealId: number | null;
}

/** Same fetch-shaped seam the providers use, so reads can be tested without a network. */
export type PipedriveTransport = (
  url: string
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const defaultTransport: PipedriveTransport = async (url) => {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  return { ok: response.ok, status: response.status, text: () => response.text() };
};

export interface PipedriveReaderOptions {
  env?: Record<string, string | undefined>;
  transport?: PipedriveTransport;
  config?: PipedriveConfig;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pipedrive returns emails and phones as arrays of `{value, primary, label}`.
 * The primary one is the answer; the first is the fallback. Picking arbitrarily
 * would eventually mail someone's old address.
 */
function primaryOf(values: unknown): string | null {
  if (!Array.isArray(values)) return str(values);
  const entries = values as { value?: unknown; primary?: unknown }[];
  const primary = entries.find((e) => e.primary === true);
  return str(primary?.value) ?? str(entries[0]?.value);
}

export class PipedriveReader {
  private readonly env: Record<string, string | undefined>;
  private readonly transport: PipedriveTransport;
  private readonly config: PipedriveConfig;

  constructor(options: PipedriveReaderOptions = {}) {
    this.env = options.env ?? process.env;
    this.transport = options.transport ?? defaultTransport;
    this.config = options.config ?? getPipedriveConfig();
  }

  /** Whether reads can happen at all. Reading needs only a token — no live-sync switch. */
  get configured(): boolean {
    return Boolean(this.env[this.config.connection.apiTokenEnvVar]?.trim());
  }

  private get base(): string {
    return this.env.PIPEDRIVE_API_BASE?.trim() || "https://api.pipedrive.com/v1";
  }

  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T[]> {
    const token = this.env[this.config.connection.apiTokenEnvVar]?.trim();
    if (!token) {
      throw new Error(
        `Pipedrive is not connected — set ${this.config.connection.apiTokenEnvVar} to let the Manager read your CRM.`
      );
    }
    const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_token: token });
    const response = await this.transport(`${this.base}${path}?${query.toString()}`);
    const text = await response.text();
    if (!response.ok) {
      // The token is in the URL, so the URL must never appear in an error.
      throw new Error(`Pipedrive returned HTTP ${response.status} for ${path}: ${text.slice(0, 200)}`);
    }
    let parsed: { data?: unknown; success?: boolean; error?: string };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error(`Pipedrive sent something that was not JSON for ${path}.`);
    }
    if (parsed.success === false) {
      throw new Error(`Pipedrive rejected the request for ${path}: ${parsed.error ?? "no reason given"}`);
    }
    const data = parsed.data;
    if (data === null || data === undefined) return [];
    return (Array.isArray(data) ? data : [data]) as T[];
  }

  async searchPersons(term: string): Promise<PipedrivePerson[]> {
    // The search endpoint returns nested `item` objects rather than plain rows.
    const results = await this.get<{ item?: Record<string, unknown> }>("/persons/search", {
      term,
      fields: "name,email,phone",
      limit: 20,
    });
    const items = results
      .map((r) => (r && typeof r === "object" && "item" in r ? r.item : r))
      .filter((item): item is Record<string, unknown> => Boolean(item));

    return items.map((item) => {
      const organization = item.organization as Record<string, unknown> | undefined;
      return {
        id: num(item.id) ?? 0,
        name: str(item.name) ?? "(unnamed)",
        email: primaryOf(item.emails ?? item.email),
        phone: primaryOf(item.phones ?? item.phone),
        organizationId: num(organization?.id),
        organizationName: str(organization?.name),
      };
    });
  }

  async searchOrganizations(term: string): Promise<PipedriveOrganization[]> {
    const results = await this.get<{ item?: Record<string, unknown> }>("/organizations/search", {
      term,
      limit: 20,
    });
    const items = results
      .map((r) => (r && typeof r === "object" && "item" in r ? r.item : r))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    return items.map((item) => ({
      id: num(item.id) ?? 0,
      name: str(item.name) ?? "(unnamed)",
      address: str(item.address),
      ownerName: str((item.owner as Record<string, unknown> | undefined)?.name),
    }));
  }

  async getPerson(id: number): Promise<PipedrivePerson | null> {
    const [item] = await this.get<Record<string, unknown>>(`/persons/${id}`);
    if (!item) return null;
    const organization = item.org_id as Record<string, unknown> | undefined;
    return {
      id: num(item.id) ?? id,
      name: str(item.name) ?? "(unnamed)",
      email: primaryOf(item.email),
      phone: primaryOf(item.phone),
      organizationId: num(organization?.value ?? organization?.id),
      organizationName: str(organization?.name),
    };
  }

  async listDeals(filter: { personId?: number; organizationId?: number; limit?: number } = {}): Promise<PipedriveDeal[]> {
    const path = filter.personId
      ? `/persons/${filter.personId}/deals`
      : filter.organizationId
        ? `/organizations/${filter.organizationId}/deals`
        : "/deals";
    const items = await this.get<Record<string, unknown>>(path, { limit: filter.limit ?? 25 });
    return items.map((item) => ({
      id: num(item.id) ?? 0,
      title: str(item.title) ?? "(untitled)",
      value: num(item.value),
      currency: str(item.currency),
      status: str(item.status) ?? "unknown",
      stageId: num(item.stage_id),
      stageName: str(item.stage_name),
      personId: num((item.person_id as Record<string, unknown> | undefined)?.value ?? item.person_id),
      organizationId: num((item.org_id as Record<string, unknown> | undefined)?.value ?? item.org_id),
      updateTime: str(item.update_time),
      expectedCloseDate: str(item.expected_close_date),
    }));
  }

  async listActivities(
    filter: { personId?: number; organizationId?: number; dealId?: number; limit?: number } = {}
  ): Promise<PipedriveActivity[]> {
    const params: Record<string, string | number> = { limit: filter.limit ?? 25 };
    if (filter.personId) params.person_id = filter.personId;
    if (filter.organizationId) params.org_id = filter.organizationId;
    if (filter.dealId) params.deal_id = filter.dealId;
    const items = await this.get<Record<string, unknown>>("/activities", params);
    return items.map((item) => ({
      id: num(item.id) ?? 0,
      subject: str(item.subject) ?? "(no subject)",
      type: str(item.type) ?? "activity",
      done: item.done === true,
      dueDate: str(item.due_date),
      personId: num(item.person_id),
      organizationId: num(item.org_id),
      dealId: num(item.deal_id),
      note: str(item.note),
    }));
  }

  /**
   * The pipeline's stages, in board order.
   *
   * Read from the account rather than from config, because the board the
   * owner actually sees is the one in Pipedrive. A hard-coded list would
   * silently stop matching the first time they rename or add a column, and
   * the dashboard would show a board that no longer exists.
   */
  async listStages(pipelineId?: number): Promise<{ id: number; name: string; order: number; pipelineId: number }[]> {
    const items = await this.get<Record<string, unknown>>("/stages", pipelineId ? { pipeline_id: pipelineId } : {});
    return items
      .map((item) => ({
        id: num(item.id) ?? 0,
        name: str(item.name) ?? "(unnamed)",
        order: num(item.order_nr) ?? 0,
        pipelineId: num(item.pipeline_id) ?? 0,
      }))
      .sort((a, b) => a.order - b.order);
  }

  /** Every open deal, for building the board. Bounded — this is a working list, not an archive. */
  async listOpenDeals(limit = 200): Promise<PipedriveDeal[]> {
    const items = await this.get<Record<string, unknown>>("/deals", { status: "open", limit });
    return items.map((item) => ({
      id: num(item.id) ?? 0,
      title: str(item.title) ?? "(untitled)",
      value: num(item.value),
      currency: str(item.currency),
      status: str(item.status) ?? "open",
      stageId: num(item.stage_id),
      stageName: str(item.stage_name),
      personId: num((item.person_id as Record<string, unknown> | undefined)?.value ?? item.person_id),
      organizationId: num((item.org_id as Record<string, unknown> | undefined)?.value ?? item.org_id),
      updateTime: str(item.update_time),
      expectedCloseDate: str(item.expected_close_date),
    }));
  }

  async listNotes(
    filter: { personId?: number; organizationId?: number; dealId?: number; limit?: number } = {}
  ): Promise<PipedriveNote[]> {
    const params: Record<string, string | number> = { limit: filter.limit ?? 25 };
    if (filter.personId) params.person_id = filter.personId;
    if (filter.organizationId) params.org_id = filter.organizationId;
    if (filter.dealId) params.deal_id = filter.dealId;
    const items = await this.get<Record<string, unknown>>("/notes", params);
    return items.map((item) => ({
      id: num(item.id) ?? 0,
      // Pipedrive notes are HTML. Stripping tags keeps them readable aloud,
      // which is where most of these end up.
      content: (str(item.content) ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      addTime: str(item.add_time),
      personId: num(item.person_id),
      organizationId: num(item.org_id),
      dealId: num(item.deal_id),
    }));
  }
}
