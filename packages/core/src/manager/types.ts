import type { AgentId } from "../types";

/**
 * AI Manager domain types.
 *
 * The shape of this layer follows one rule: the Manager's *competence* lives
 * in typed tools that really query and change the platform, and the language
 * model (when one is configured) only chooses which tool to run. That way the
 * same capabilities exist with or without an API key — only the quality of the
 * routing changes. See manager/tools.ts and manager/brain.ts.
 */

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export type MessageRole = "owner" | "manager" | "agent" | "system";

export interface Conversation {
  id: string;
  title: string;
  /**
   * When set, the conversation is "focused" on one employee: follow-up
   * instructions with no explicit target route to them. This is what makes
   * "let me talk to the Scout" followed by "you're finding too many chains"
   * land on the Scout.
   */
  focusAgentId: AgentId | null;
  startedAt: string;
  lastMessageAt: string;
  endedAt: string | null;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  /** Set when role is "agent" — which employee the Manager is relaying. */
  agentId: AgentId | null;
  content: string;
  /** Which intent the brain resolved this turn to. Null for owner messages. */
  intent: string | null;
  /** Which brain produced it, so a bad route can be traced to its source. */
  brain: string | null;
  toolCalls: ToolCallRecord[];
  createdAt: string;
}

export interface ToolCallRecord {
  tool: string;
  params: Record<string, unknown>;
  status: "succeeded" | "failed" | "pending_approval" | "rejected";
  summary?: string;
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

export type InstructionScope = "permanent" | "temporary";
export type InstructionStatus = "active" | "superseded" | "revoked" | "expired";

/**
 * A machine-applicable consequence of an instruction.
 *
 * Only these kinds are genuinely enforced by the pipeline. An instruction that
 * doesn't map to one is stored as ADVISORY — recorded, versioned, shown on the
 * employee's page and quoted back on request, but not automatically applied.
 * That distinction is stated plainly everywhere it's surfaced: an instruction
 * that silently changed nothing would be worse than no instruction at all.
 */
export type InstructionEffect =
  | { kind: "exclude_name_patterns"; patterns: string[] }
  | { kind: "restrict_cities"; cities: string[] }
  | { kind: "score_adjust"; condition: ScoreCondition; points: number; label: string }
  | { kind: "min_score_threshold"; minScore: number };

/** Conditions a score_adjust instruction can key off. Each maps to a real Lead field. */
export type ScoreCondition =
  | "no_online_booking"
  | "no_website"
  | "poor_website"
  | "phone_only_booking"
  | "broken_booking_link"
  | "independent_business";

export interface AgentInstruction {
  id: string;
  agentId: AgentId;
  instruction: string;
  scope: InstructionScope;
  status: InstructionStatus;
  /** Null means advisory — see InstructionEffect. */
  effect: InstructionEffect | null;
  effectKind: string | null;
  rationale: string | null;
  source: string;
  conversationId: string | null;
  messageId: string | null;
  createdBy: string;
  version: number;
  supersedesId: string | null;
  supersededById: string | null;
  /** Temporary scope: bound to one campaign, and/or expiring at a time. */
  campaignId: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

// ---------------------------------------------------------------------------
// Actions + approvals
// ---------------------------------------------------------------------------

/**
 * How much damage a tool could do if the Manager misunderstood.
 *
 *   low    — reads only. Runs immediately.
 *   medium — changes how the system behaves, or moves work along. Confirm.
 *   high   — destructive, irreversible, outward-facing, or costs money. Confirm,
 *            and say exactly what will happen first.
 */
export type ActionRisk = "low" | "medium" | "high";

export type ActionStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "running"
  | "succeeded"
  | "failed";

export interface ManagerAction {
  id: string;
  conversationId: string | null;
  messageId: string | null;
  agentId: AgentId | null;
  tool: string;
  params: Record<string, unknown>;
  risk: ActionRisk;
  status: ActionStatus;
  /** Captured before running, so an approval records what was actually approved. */
  intentSummary: string;
  resultSummary: string | null;
  error: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type ReportType = "daily" | "weekly" | "briefing" | "custom";

export interface Report {
  id: string;
  type: ReportType;
  title: string;
  periodStart: string;
  periodEnd: string;
  /** The numbers the summary was written from, so it can be re-read later. */
  metrics: ReportMetrics;
  summary: string;
  generatedBy: string;
  scheduledTaskId: string | null;
  generatedAt: string;
}

/**
 * Every field here is counted from real rows in the period. Nothing is
 * estimated or carried over from a previous report.
 */
export interface ReportMetrics {
  businessesDiscovered: number;
  businessesResearched: number;
  businessesAnalyzed: number;
  qualifiedLeads: number;
  highPriorityLeads: number;
  rejectedLeads: number;
  duplicatesRemoved: number;
  jobsCompleted: number;
  jobsFailed: number;
  openHumanReviewItems: number;
  averageScore: number | null;
  topLeads: { id: string; businessName: string; city: string; score: number | null }[];
  agentActivityCounts: { agentId: string; actions: number; errors: number }[];
  instructionsChanged: number;
  /** Same metrics for the preceding period of equal length, when one exists. */
  previousPeriod: PeriodComparison | null;
}

export interface PeriodComparison {
  periodStart: string;
  periodEnd: string;
  businessesDiscovered: number;
  qualifiedLeads: number;
  highPriorityLeads: number;
  averageScore: number | null;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export type ScheduledTaskKind = "daily_report" | "weekly_report";

export interface ScheduledTask {
  id: string;
  name: string;
  kind: ScheduledTaskKind;
  /** The owner's own sentence, kept verbatim. */
  instruction: string;
  hour: number;
  minute: number;
  /** 0=Sunday..6=Saturday for weekly schedules; null for daily. */
  dayOfWeek: number | null;
  timezone: string;
  active: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

export interface ConversationsRepository {
  create(conversation: Conversation): Promise<Conversation>;
  update(conversation: Conversation): Promise<Conversation>;
  getById(id: string): Promise<Conversation | null>;
  list(limit?: number): Promise<Conversation[]>;
  addMessage(message: ConversationMessage): Promise<ConversationMessage>;
  listMessages(conversationId: string, limit?: number): Promise<ConversationMessage[]>;
  /** Cross-conversation history, for "what did I say last Tuesday". */
  searchMessages(filter: { since?: string; until?: string; agentId?: AgentId; limit?: number }): Promise<ConversationMessage[]>;
}

export interface InstructionsRepository {
  create(instruction: AgentInstruction): Promise<AgentInstruction>;
  update(instruction: AgentInstruction): Promise<AgentInstruction>;
  getById(id: string): Promise<AgentInstruction | null>;
  list(filter?: {
    agentId?: AgentId;
    scope?: InstructionScope;
    status?: InstructionStatus;
    campaignId?: string;
    since?: string;
    limit?: number;
  }): Promise<AgentInstruction[]>;
}

export interface ManagerActionsRepository {
  create(action: ManagerAction): Promise<ManagerAction>;
  update(action: ManagerAction): Promise<ManagerAction>;
  getById(id: string): Promise<ManagerAction | null>;
  list(filter?: { status?: ActionStatus; conversationId?: string; since?: string; limit?: number }): Promise<ManagerAction[]>;
}

export interface ReportsRepository {
  create(report: Report): Promise<Report>;
  getById(id: string): Promise<Report | null>;
  list(filter?: { type?: ReportType; since?: string; until?: string; limit?: number }): Promise<Report[]>;
}

export interface ScheduledTasksRepository {
  create(task: ScheduledTask): Promise<ScheduledTask>;
  update(task: ScheduledTask): Promise<ScheduledTask>;
  getById(id: string): Promise<ScheduledTask | null>;
  list(filter?: { active?: boolean; dueBefore?: string }): Promise<ScheduledTask[]>;
}
