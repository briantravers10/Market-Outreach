import type { SqlClient } from "../sqlClient";
import type {
  ActionStatus,
  AgentId,
  AgentInstruction,
  Conversation,
  ConversationMessage,
  ConversationsRepository,
  InstructionEffect,
  InstructionScope,
  InstructionStatus,
  InstructionsRepository,
  ManagerAction,
  ManagerActionsRepository,
  MessageRole,
  Report,
  ReportMetrics,
  ReportType,
  ReportsRepository,
  ScheduledTask,
  ScheduledTaskKind,
  ScheduledTasksRepository,
  ToolCallRecord,
} from "@market-outreach/core";

/**
 * Storage for the AI Manager: conversations, instructions, actions, reports
 * and schedules.
 *
 * Written once against the SqlClient shim, so the same code serves SQLite
 * locally and Postgres when DATABASE_URL is set — same as every other
 * repository here.
 *
 * JSON columns are stored as TEXT and parsed at this boundary, so nothing
 * above this layer ever handles a raw string where it expects an object.
 */

/** Parses a JSON column, falling back rather than throwing on a corrupt row. */
function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Conversations + messages
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string;
  title: string;
  focus_agent_id: string | null;
  started_at: string;
  last_message_at: string;
  ended_at: string | null;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    focusAgentId: (row.focus_agent_id as AgentId | null) ?? null,
    startedAt: row.started_at,
    lastMessageAt: row.last_message_at,
    endedAt: row.ended_at,
  };
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  agent_id: string | null;
  content: string;
  intent: string | null;
  brain: string | null;
  tool_calls: string;
  created_at: string;
}

function toMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as MessageRole,
    agentId: (row.agent_id as AgentId | null) ?? null,
    content: row.content,
    intent: row.intent,
    brain: row.brain,
    toolCalls: parseJson<ToolCallRecord[]>(row.tool_calls, []),
    createdAt: row.created_at,
  };
}

export function createConversationsRepo(db: SqlClient): ConversationsRepository {
  return {
    async create(conversation) {
      await db
        .prepare(
          `INSERT INTO manager_conversations (id, title, focus_agent_id, started_at, last_message_at, ended_at)
           VALUES (@id, @title, @focusAgentId, @startedAt, @lastMessageAt, @endedAt)`
        )
        .run(conversation);
      return conversation;
    },

    async update(conversation) {
      await db
        .prepare(
          `UPDATE manager_conversations
              SET title = @title, focus_agent_id = @focusAgentId,
                  last_message_at = @lastMessageAt, ended_at = @endedAt
            WHERE id = @id`
        )
        .run(conversation);
      return conversation;
    },

    async getById(id) {
      const row = (await db
        .prepare(`SELECT * FROM manager_conversations WHERE id = ?`)
        .get(id)) as ConversationRow | undefined;
      return row ? toConversation(row) : null;
    },

    async list(limit = 50) {
      const rows = (await db
        .prepare(`SELECT * FROM manager_conversations ORDER BY last_message_at DESC LIMIT @limit`)
        .all({ limit })) as ConversationRow[];
      return rows.map(toConversation);
    },

    async addMessage(message) {
      await db
        .prepare(
          `INSERT INTO manager_messages
             (id, conversation_id, role, agent_id, content, intent, brain, tool_calls, created_at)
           VALUES (@id, @conversationId, @role, @agentId, @content, @intent, @brain, @toolCalls, @createdAt)`
        )
        .run({ ...message, toolCalls: JSON.stringify(message.toolCalls ?? []) });
      return message;
    },

    async listMessages(conversationId, limit = 200) {
      const rows = (await db
        .prepare(
          `SELECT * FROM manager_messages WHERE conversation_id = @conversationId
            ORDER BY created_at ASC LIMIT @limit`
        )
        .all({ conversationId, limit })) as MessageRow[];
      return rows.map(toMessage);
    },

    async searchMessages(filter = {}) {
      const clauses: string[] = [];
      const params: Record<string, unknown> = {};
      if (filter.since) {
        clauses.push("created_at >= @since");
        params.since = filter.since;
      }
      if (filter.until) {
        clauses.push("created_at <= @until");
        params.until = filter.until;
      }
      if (filter.agentId) {
        clauses.push("agent_id = @agentId");
        params.agentId = filter.agentId;
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.limit = filter.limit ?? 200;
      const rows = (await db
        .prepare(`SELECT * FROM manager_messages ${where} ORDER BY created_at DESC LIMIT @limit`)
        .all(params)) as MessageRow[];
      return rows.map(toMessage);
    },
  };
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

interface InstructionRow {
  id: string;
  agent_id: string;
  instruction: string;
  scope: string;
  status: string;
  effect: string | null;
  effect_kind: string | null;
  rationale: string | null;
  source: string;
  conversation_id: string | null;
  message_id: string | null;
  created_by: string;
  version: number;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  campaign_id: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

function toInstruction(row: InstructionRow): AgentInstruction {
  return {
    id: row.id,
    agentId: row.agent_id as AgentId,
    instruction: row.instruction,
    scope: row.scope as InstructionScope,
    status: row.status as InstructionStatus,
    effect: row.effect ? parseJson<InstructionEffect | null>(row.effect, null) : null,
    effectKind: row.effect_kind,
    rationale: row.rationale,
    source: row.source,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    createdBy: row.created_by,
    // Postgres returns INTEGER as a number; SQLite may hand back a string.
    version: Number(row.version),
    supersedesId: row.supersedes_id,
    supersededById: row.superseded_by_id,
    campaignId: row.campaign_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  };
}

function instructionParams(instruction: AgentInstruction) {
  return {
    ...instruction,
    effect: instruction.effect ? JSON.stringify(instruction.effect) : null,
  };
}

export function createInstructionsRepo(db: SqlClient): InstructionsRepository {
  return {
    async create(instruction) {
      await db
        .prepare(
          `INSERT INTO agent_instructions
             (id, agent_id, instruction, scope, status, effect, effect_kind, rationale, source,
              conversation_id, message_id, created_by, version, supersedes_id, superseded_by_id,
              campaign_id, expires_at, created_at, revoked_at, revoked_reason)
           VALUES
             (@id, @agentId, @instruction, @scope, @status, @effect, @effectKind, @rationale, @source,
              @conversationId, @messageId, @createdBy, @version, @supersedesId, @supersededById,
              @campaignId, @expiresAt, @createdAt, @revokedAt, @revokedReason)`
        )
        .run(instructionParams(instruction));
      return instruction;
    },

    async update(instruction) {
      await db
        .prepare(
          `UPDATE agent_instructions
              SET instruction = @instruction, scope = @scope, status = @status,
                  effect = @effect, effect_kind = @effectKind, rationale = @rationale,
                  superseded_by_id = @supersededById, campaign_id = @campaignId,
                  expires_at = @expiresAt, revoked_at = @revokedAt, revoked_reason = @revokedReason
            WHERE id = @id`
        )
        .run(instructionParams(instruction));
      return instruction;
    },

    async getById(id) {
      const row = (await db
        .prepare(`SELECT * FROM agent_instructions WHERE id = ?`)
        .get(id)) as InstructionRow | undefined;
      return row ? toInstruction(row) : null;
    },

    async list(filter = {}) {
      const clauses: string[] = [];
      const params: Record<string, unknown> = {};
      if (filter.agentId) {
        clauses.push("agent_id = @agentId");
        params.agentId = filter.agentId;
      }
      if (filter.scope) {
        clauses.push("scope = @scope");
        params.scope = filter.scope;
      }
      if (filter.status) {
        clauses.push("status = @status");
        params.status = filter.status;
      }
      if (filter.campaignId) {
        clauses.push("campaign_id = @campaignId");
        params.campaignId = filter.campaignId;
      }
      if (filter.since) {
        clauses.push("created_at >= @since");
        params.since = filter.since;
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.limit = filter.limit ?? 200;
      const rows = (await db
        .prepare(`SELECT * FROM agent_instructions ${where} ORDER BY created_at DESC LIMIT @limit`)
        .all(params)) as InstructionRow[];
      return rows.map(toInstruction);
    },
  };
}

// ---------------------------------------------------------------------------
// Manager actions
// ---------------------------------------------------------------------------

interface ActionRow {
  id: string;
  conversation_id: string | null;
  message_id: string | null;
  agent_id: string | null;
  tool: string;
  params: string;
  risk: string;
  status: string;
  intent_summary: string;
  result_summary: string | null;
  error: string | null;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  started_at: string | null;
  finished_at: string | null;
}

function toAction(row: ActionRow): ManagerAction {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    agentId: (row.agent_id as AgentId | null) ?? null,
    tool: row.tool,
    params: parseJson<Record<string, unknown>>(row.params, {}),
    risk: row.risk as ManagerAction["risk"],
    status: row.status as ActionStatus,
    intentSummary: row.intent_summary,
    resultSummary: row.result_summary,
    error: row.error,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function createManagerActionsRepo(db: SqlClient): ManagerActionsRepository {
  return {
    async create(action) {
      await db
        .prepare(
          `INSERT INTO manager_actions
             (id, conversation_id, message_id, agent_id, tool, params, risk, status, intent_summary,
              result_summary, error, requested_at, decided_at, decided_by, started_at, finished_at)
           VALUES
             (@id, @conversationId, @messageId, @agentId, @tool, @params, @risk, @status, @intentSummary,
              @resultSummary, @error, @requestedAt, @decidedAt, @decidedBy, @startedAt, @finishedAt)`
        )
        .run({ ...action, params: JSON.stringify(action.params ?? {}) });
      return action;
    },

    async update(action) {
      await db
        .prepare(
          `UPDATE manager_actions
              SET status = @status, result_summary = @resultSummary, error = @error,
                  decided_at = @decidedAt, decided_by = @decidedBy,
                  started_at = @startedAt, finished_at = @finishedAt
            WHERE id = @id`
        )
        .run({ ...action, params: JSON.stringify(action.params ?? {}) });
      return action;
    },

    async getById(id) {
      const row = (await db.prepare(`SELECT * FROM manager_actions WHERE id = ?`).get(id)) as ActionRow | undefined;
      return row ? toAction(row) : null;
    },

    async list(filter = {}) {
      const clauses: string[] = [];
      const params: Record<string, unknown> = {};
      if (filter.status) {
        clauses.push("status = @status");
        params.status = filter.status;
      }
      if (filter.conversationId) {
        clauses.push("conversation_id = @conversationId");
        params.conversationId = filter.conversationId;
      }
      if (filter.since) {
        clauses.push("requested_at >= @since");
        params.since = filter.since;
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.limit = filter.limit ?? 100;
      const rows = (await db
        .prepare(`SELECT * FROM manager_actions ${where} ORDER BY requested_at DESC LIMIT @limit`)
        .all(params)) as ActionRow[];
      return rows.map(toAction);
    },
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

interface ReportRow {
  id: string;
  type: string;
  title: string;
  period_start: string;
  period_end: string;
  metrics: string;
  summary: string;
  generated_by: string;
  scheduled_task_id: string | null;
  generated_at: string;
}

const EMPTY_METRICS: ReportMetrics = {
  businessesDiscovered: 0,
  businessesResearched: 0,
  businessesAnalyzed: 0,
  qualifiedLeads: 0,
  highPriorityLeads: 0,
  rejectedLeads: 0,
  duplicatesRemoved: 0,
  jobsCompleted: 0,
  jobsFailed: 0,
  openHumanReviewItems: 0,
  averageScore: null,
  topLeads: [],
  agentActivityCounts: [],
  instructionsChanged: 0,
  previousPeriod: null,
};

function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    type: row.type as ReportType,
    title: row.title,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    metrics: parseJson<ReportMetrics>(row.metrics, EMPTY_METRICS),
    summary: row.summary,
    generatedBy: row.generated_by,
    scheduledTaskId: row.scheduled_task_id,
    generatedAt: row.generated_at,
  };
}

export function createReportsRepo(db: SqlClient): ReportsRepository {
  return {
    async create(report) {
      await db
        .prepare(
          `INSERT INTO reports
             (id, type, title, period_start, period_end, metrics, summary, generated_by,
              scheduled_task_id, generated_at)
           VALUES
             (@id, @type, @title, @periodStart, @periodEnd, @metrics, @summary, @generatedBy,
              @scheduledTaskId, @generatedAt)`
        )
        .run({ ...report, metrics: JSON.stringify(report.metrics ?? EMPTY_METRICS) });
      return report;
    },

    async getById(id) {
      const row = (await db.prepare(`SELECT * FROM reports WHERE id = ?`).get(id)) as ReportRow | undefined;
      return row ? toReport(row) : null;
    },

    async list(filter = {}) {
      const clauses: string[] = [];
      const params: Record<string, unknown> = {};
      if (filter.type) {
        clauses.push("type = @type");
        params.type = filter.type;
      }
      if (filter.since) {
        clauses.push("generated_at >= @since");
        params.since = filter.since;
      }
      if (filter.until) {
        clauses.push("generated_at <= @until");
        params.until = filter.until;
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      params.limit = filter.limit ?? 100;
      const rows = (await db
        .prepare(`SELECT * FROM reports ${where} ORDER BY generated_at DESC LIMIT @limit`)
        .all(params)) as ReportRow[];
      return rows.map(toReport);
    },
  };
}

// ---------------------------------------------------------------------------
// Scheduled tasks
// ---------------------------------------------------------------------------

interface ScheduledTaskRow {
  id: string;
  name: string;
  kind: string;
  instruction: string;
  hour: number;
  minute: number;
  day_of_week: number | null;
  timezone: string;
  active: number;
  last_run_at: string | null;
  last_run_status: string | null;
  next_run_at: string | null;
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

function toScheduledTask(row: ScheduledTaskRow): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ScheduledTaskKind,
    instruction: row.instruction,
    hour: Number(row.hour),
    minute: Number(row.minute),
    dayOfWeek: row.day_of_week === null || row.day_of_week === undefined ? null : Number(row.day_of_week),
    timezone: row.timezone,
    // SQLite has no boolean type and Postgres returns INTEGER; normalize here
    // so callers only ever see a real boolean.
    active: Number(row.active) === 1,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    nextRunAt: row.next_run_at,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function taskParams(task: ScheduledTask) {
  return { ...task, active: task.active ? 1 : 0 };
}

export function createScheduledTasksRepo(db: SqlClient): ScheduledTasksRepository {
  return {
    async create(task) {
      await db
        .prepare(
          `INSERT INTO scheduled_tasks
             (id, name, kind, instruction, hour, minute, day_of_week, timezone, active,
              last_run_at, last_run_status, next_run_at, conversation_id, created_at, updated_at)
           VALUES
             (@id, @name, @kind, @instruction, @hour, @minute, @dayOfWeek, @timezone, @active,
              @lastRunAt, @lastRunStatus, @nextRunAt, @conversationId, @createdAt, @updatedAt)`
        )
        .run(taskParams(task));
      return task;
    },

    async update(task) {
      await db
        .prepare(
          `UPDATE scheduled_tasks
              SET name = @name, kind = @kind, instruction = @instruction, hour = @hour, minute = @minute,
                  day_of_week = @dayOfWeek, timezone = @timezone, active = @active,
                  last_run_at = @lastRunAt, last_run_status = @lastRunStatus, next_run_at = @nextRunAt,
                  updated_at = @updatedAt
            WHERE id = @id`
        )
        .run(taskParams(task));
      return task;
    },

    async getById(id) {
      const row = (await db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(id)) as
        | ScheduledTaskRow
        | undefined;
      return row ? toScheduledTask(row) : null;
    },

    async list(filter = {}) {
      const clauses: string[] = [];
      const params: Record<string, unknown> = {};
      if (filter.active !== undefined) {
        clauses.push("active = @active");
        params.active = filter.active ? 1 : 0;
      }
      if (filter.dueBefore) {
        clauses.push("next_run_at IS NOT NULL AND next_run_at <= @dueBefore");
        params.dueBefore = filter.dueBefore;
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = (await db
        .prepare(`SELECT * FROM scheduled_tasks ${where} ORDER BY created_at DESC`)
        .all(params)) as ScheduledTaskRow[];
      return rows.map(toScheduledTask);
    },
  };
}
