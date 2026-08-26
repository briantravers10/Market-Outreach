import type {
  Communication,
  CommunicationFilter,
  CommunicationsRepository,
} from "@market-outreach/core";
import type { SqlClient } from "../sqlClient";

interface CommunicationRow {
  id: string;
  channel: string;
  direction: string;
  status: string;
  contact_name: string | null;
  business_name: string | null;
  destination: string;
  sender: string | null;
  subject: string | null;
  body: string;
  approved_at: string | null;
  approved_by: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  provider: string | null;
  error: string | null;
  conversation_id: string | null;
  action_id: string | null;
  lead_id: string | null;
  pipedrive_person_id: number | null;
  pipedrive_org_id: number | null;
  pipedrive_deal_id: number | null;
  pipedrive_activity_id: number | null;
  in_reply_to_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToCommunication(row: CommunicationRow): Communication {
  return {
    id: row.id,
    channel: row.channel as Communication["channel"],
    direction: row.direction as Communication["direction"],
    status: row.status as Communication["status"],
    contactName: row.contact_name,
    businessName: row.business_name,
    destination: row.destination,
    sender: row.sender,
    subject: row.subject,
    body: row.body,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    providerMessageId: row.provider_message_id,
    provider: row.provider,
    error: row.error,
    conversationId: row.conversation_id,
    actionId: row.action_id,
    leadId: row.lead_id,
    // Postgres returns bigint-ish columns as strings through some drivers, so
    // these are coerced rather than trusted — a Pipedrive id that arrives as
    // "412" and leaves as 412 is the difference between a matched CRM record
    // and a duplicate one.
    pipedrivePersonId: row.pipedrive_person_id === null ? null : Number(row.pipedrive_person_id),
    pipedriveOrgId: row.pipedrive_org_id === null ? null : Number(row.pipedrive_org_id),
    pipedriveDealId: row.pipedrive_deal_id === null ? null : Number(row.pipedrive_deal_id),
    pipedriveActivityId: row.pipedrive_activity_id === null ? null : Number(row.pipedrive_activity_id),
    inReplyToId: row.in_reply_to_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = [
  "id", "channel", "direction", "status", "contact_name", "business_name", "destination", "sender",
  "subject", "body", "approved_at", "approved_by", "scheduled_for", "sent_at", "provider_message_id",
  "provider", "error", "conversation_id", "action_id", "lead_id", "pipedrive_person_id",
  "pipedrive_org_id", "pipedrive_deal_id", "pipedrive_activity_id", "in_reply_to_id",
  "created_at", "updated_at",
] as const;

function toRow(communication: Communication): Record<string, unknown> {
  return {
    id: communication.id,
    channel: communication.channel,
    direction: communication.direction,
    status: communication.status,
    contact_name: communication.contactName,
    business_name: communication.businessName,
    destination: communication.destination,
    sender: communication.sender,
    subject: communication.subject,
    body: communication.body,
    approved_at: communication.approvedAt,
    approved_by: communication.approvedBy,
    scheduled_for: communication.scheduledFor,
    sent_at: communication.sentAt,
    provider_message_id: communication.providerMessageId,
    provider: communication.provider,
    error: communication.error,
    conversation_id: communication.conversationId,
    action_id: communication.actionId,
    lead_id: communication.leadId,
    pipedrive_person_id: communication.pipedrivePersonId,
    pipedrive_org_id: communication.pipedriveOrgId,
    pipedrive_deal_id: communication.pipedriveDealId,
    pipedrive_activity_id: communication.pipedriveActivityId,
    in_reply_to_id: communication.inReplyToId,
    created_at: communication.createdAt,
    updated_at: communication.updatedAt,
  };
}

/** Statuses that still want something from the owner or the system. */
const OPEN_STATUSES = ["draft", "awaiting_approval", "approved", "scheduled", "sending", "failed"];

function buildWhere(filter: CommunicationFilter): { where: string; params: Record<string, unknown> } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.channel) { clauses.push("channel = @channel"); params.channel = filter.channel; }
  if (filter.direction) { clauses.push("direction = @direction"); params.direction = filter.direction; }
  if (filter.status) { clauses.push("status = @status"); params.status = filter.status; }
  if (filter.openOnly) {
    clauses.push(`status IN (${OPEN_STATUSES.map((s) => `'${s}'`).join(", ")})`);
  }
  if (filter.contactName) {
    clauses.push("LOWER(contact_name) LIKE @contactName");
    params.contactName = `%${filter.contactName.toLowerCase()}%`;
  }
  if (filter.businessName) {
    clauses.push("LOWER(business_name) LIKE @businessName");
    params.businessName = `%${filter.businessName.toLowerCase()}%`;
  }
  if (filter.destination) { clauses.push("destination = @destination"); params.destination = filter.destination; }
  if (filter.leadId) { clauses.push("lead_id = @leadId"); params.leadId = filter.leadId; }
  if (filter.conversationId) { clauses.push("conversation_id = @conversationId"); params.conversationId = filter.conversationId; }
  if (filter.since) { clauses.push("created_at >= @since"); params.since = filter.since; }
  if (filter.until) { clauses.push("created_at < @until"); params.until = filter.until; }

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export class SqlCommunicationsRepository implements CommunicationsRepository {
  constructor(private readonly db: SqlClient) {}

  async create(communication: Communication): Promise<Communication> {
    const row = toRow(communication);
    await this.db
      .prepare(
        `INSERT INTO communications (${COLUMNS.join(", ")})
         VALUES (${COLUMNS.map((c) => `@${c}`).join(", ")})`
      )
      .run(row);
    return communication;
  }

  async update(communication: Communication): Promise<Communication> {
    const row = toRow(communication);
    // id and created_at are identity, not state, so they are never updated.
    const updatable = COLUMNS.filter((c) => c !== "id" && c !== "created_at");
    await this.db
      .prepare(
        `UPDATE communications SET ${updatable.map((c) => `${c} = @${c}`).join(", ")} WHERE id = @id`
      )
      .run(row);
    return communication;
  }

  async getById(id: string): Promise<Communication | null> {
    const row = (await this.db
      .prepare("SELECT * FROM communications WHERE id = ?")
      .get(id)) as CommunicationRow | undefined;
    return row ? rowToCommunication(row) : null;
  }

  async list(filter: CommunicationFilter = {}): Promise<Communication[]> {
    const { where, params } = buildWhere(filter);
    const limit = Number.isFinite(filter.limit) ? Math.max(0, Math.floor(filter.limit as number)) : 200;
    const offset = Number.isFinite(filter.offset) ? Math.max(0, Math.floor(filter.offset as number)) : 0;
    const rows = (await this.db
      .prepare(
        `SELECT * FROM communications ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
      )
      .all(params)) as CommunicationRow[];
    return rows.map(rowToCommunication);
  }

  async count(filter: CommunicationFilter = {}): Promise<number> {
    const { where, params } = buildWhere(filter);
    const row = (await this.db
      .prepare(`SELECT COUNT(*) AS n FROM communications ${where}`)
      .get(params)) as { n: number | string } | undefined;
    return Number(row?.n ?? 0);
  }

  async findByProviderMessageId(providerMessageId: string): Promise<Communication | null> {
    const row = (await this.db
      .prepare("SELECT * FROM communications WHERE provider_message_id = ?")
      .get(providerMessageId)) as CommunicationRow | undefined;
    return row ? rowToCommunication(row) : null;
  }
}
