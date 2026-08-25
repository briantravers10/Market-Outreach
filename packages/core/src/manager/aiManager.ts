import { randomUUID } from "node:crypto";
import type { AgentId, Repositories } from "../types";
import { logActivity } from "../agents/agentActivity";
import type { CommandParser } from "../nlp/commandParser";
import type { ProspectingManager } from "../prospectingManager";
import type { BrainRequest, ManagerBrain } from "./brain";
import { requiresApproval, findTool, type ToolContext, type ToolResult } from "./tools";
import type { Conversation, ConversationMessage, ManagerAction, ToolCallRecord } from "./types";

/**
 * The AI Manager: one turn of conversation, start to finish.
 *
 * Order of operations, and why:
 *
 *   1. Record what the owner said. Written FIRST, so a crash anywhere later
 *      still leaves the request on the record.
 *   2. Ask the brain which tool to run.
 *   3. If the tool is consequential, write a pending action and stop. Nothing
 *      runs until the owner approves it.
 *   4. Otherwise run it, capture the outcome, and record the reply.
 *
 * Every step writes to the database rather than relying on the model's own
 * memory of the conversation, which is the difference between an assistant that
 * remembers and one that appears to.
 */

export interface AiManagerDeps {
  repos: Repositories;
  brain: ManagerBrain;
  manager: ProspectingManager;
  commandParser: CommandParser;
  /** Injectable so tests and scheduled runs are deterministic. */
  now?: () => Date;
  /**
   * Set false where the database cannot be written to — the public demo opens
   * a read-only snapshot.
   *
   * In that mode the Manager still answers questions properly, because reading
   * is all those need. What it does NOT do is record the conversation or run
   * anything consequential; it says so instead. Without this the demo fails on
   * the very first turn, since the owner's message is written before the
   * request is even looked at.
   */
  persist?: boolean;
}

export interface TurnResult {
  conversation: Conversation;
  ownerMessage: ConversationMessage;
  managerMessage: ConversationMessage;
  /** Set when the turn stopped to ask permission. */
  pendingAction: ManagerAction | null;
  data?: unknown;
}

export class AiManager {
  private readonly now: () => Date;
  private readonly persist: boolean;

  constructor(private readonly deps: AiManagerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.persist = deps.persist !== false;
  }

  // -------------------------------------------------------------------------
  // Conversations
  // -------------------------------------------------------------------------

  async startConversation(title = "New conversation"): Promise<Conversation> {
    const ts = this.now().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      title,
      focusAgentId: null,
      startedAt: ts,
      lastMessageAt: ts,
      endedAt: null,
    };
    if (!this.persist) return conversation;
    return this.deps.repos.conversations.create(conversation);
  }

  /** The most recent open conversation, or a new one. */
  async currentConversation(): Promise<Conversation> {
    if (!this.persist) return this.startConversation();
    const [latest] = await this.deps.repos.conversations.list(1);
    if (latest && !latest.endedAt) return latest;
    return this.startConversation();
  }

  private async record(
    conversationId: string,
    role: ConversationMessage["role"],
    content: string,
    extra: Partial<ConversationMessage> = {}
  ): Promise<ConversationMessage> {
    const message: ConversationMessage = {
      id: randomUUID(),
      conversationId,
      role,
      agentId: extra.agentId ?? null,
      content,
      intent: extra.intent ?? null,
      brain: extra.brain ?? null,
      toolCalls: extra.toolCalls ?? [],
      createdAt: this.now().toISOString(),
    };
    if (this.persist) await this.deps.repos.conversations.addMessage(message);
    return message;
  }

  // -------------------------------------------------------------------------
  // A turn
  // -------------------------------------------------------------------------

  async handle(text: string, conversationId?: string): Promise<TurnResult> {
    const conversation =
      conversationId && this.persist
        ? (await this.deps.repos.conversations.getById(conversationId)) ?? (await this.currentConversation())
        : await this.currentConversation();

    // Recorded before anything can fail.
    const ownerMessage = await this.record(conversation.id, "owner", text);

    const priorMessages = this.persist
      ? await this.deps.repos.conversations.listMessages(conversation.id, 40)
      : [];
    const history = priorMessages
      .filter((m) => m.id !== ownerMessage.id && (m.role === "owner" || m.role === "manager"))
      .slice(-10)
      .map((m) => ({ role: m.role as "owner" | "manager", content: m.content }));

    const ctx: ToolContext = {
      repos: this.deps.repos,
      manager: this.deps.manager,
      commandParser: this.deps.commandParser,
      now: this.now,
      conversationId: conversation.id,
      messageId: ownerMessage.id,
      focusAgentId: conversation.focusAgentId,
    };

    const request: BrainRequest = { text, history, focusAgentId: conversation.focusAgentId };

    let plan;
    try {
      plan = await this.deps.brain.plan(request, ctx);
    } catch (error) {
      // A brain failure (network, bad key, rate limit) must not lose the turn.
      const message = error instanceof Error ? error.message : String(error);
      const managerMessage = await this.record(
        conversation.id,
        "manager",
        `I couldn't process that — my language service returned an error (${message}). Everything else still works; try rephrasing, or check the API key.`,
        { intent: "brain_error", brain: this.deps.brain.name }
      );
      await this.touch(conversation);
      return { conversation, ownerMessage, managerMessage, pendingAction: null };
    }

    if (plan.setFocusAgentId !== undefined) {
      conversation.focusAgentId = plan.setFocusAgentId;
      if (this.persist) await this.deps.repos.conversations.update(conversation);
      ctx.focusAgentId = plan.setFocusAgentId;
    }

    // Nothing to run — the Manager is just talking.
    if (!plan.tool) {
      const managerMessage = await this.record(conversation.id, "manager", plan.reply ?? "", {
        intent: plan.intent,
        brain: this.deps.brain.name,
      });
      await this.touch(conversation);
      return { conversation, ownerMessage, managerMessage, pendingAction: null };
    }

    const action: ManagerAction = {
      id: randomUUID(),
      conversationId: conversation.id,
      messageId: ownerMessage.id,
      agentId: (plan.params.agent as AgentId | undefined) ?? conversation.focusAgentId,
      tool: plan.tool.name,
      params: plan.params,
      risk: plan.tool.risk,
      status: requiresApproval(plan.tool) ? "pending_approval" : "running",
      intentSummary: plan.tool.describe(plan.params, ctx),
      resultSummary: null,
      error: null,
      requestedAt: this.now().toISOString(),
      decidedAt: null,
      decidedBy: null,
      startedAt: null,
      finishedAt: null,
    };

    // Nothing consequential can complete against a read-only database, so say
    // that up front rather than asking for an approval that would then fail.
    if (!this.persist && requiresApproval(plan.tool)) {
      const managerMessage = await this.record(
        conversation.id,
        "manager",
        `${action.intentSummary} — but this is the read-only demo, so I can't actually change anything here.`,
        { intent: plan.intent, brain: this.deps.brain.name }
      );
      return { conversation, ownerMessage, managerMessage, pendingAction: null };
    }

    // Consequential work stops here and waits. The Manager states exactly what
    // it intends to do; nothing happens until the owner says yes.
    if (requiresApproval(plan.tool)) {
      if (this.persist) await this.deps.repos.managerActions.create(action);
      const managerMessage = await this.record(
        conversation.id,
        "manager",
        `${action.intentSummary} Shall I go ahead?`,
        {
          intent: plan.intent,
          brain: this.deps.brain.name,
          toolCalls: [{ tool: plan.tool.name, params: plan.params, status: "pending_approval" }],
        }
      );
      await this.touch(conversation);
      return { conversation, ownerMessage, managerMessage, pendingAction: action };
    }

    action.startedAt = this.now().toISOString();
    if (this.persist) await this.deps.repos.managerActions.create(action);
    const { message: managerMessage, data } = await this.execute(action, plan.tool.name, ctx, {
      intent: plan.intent,
      brain: this.deps.brain.name,
      acknowledgement: plan.acknowledgement,
    });
    await this.touch(conversation);
    return { conversation, ownerMessage, managerMessage, pendingAction: null, data };
  }

  /** Runs an approved-or-low-risk action and records the outcome either way. */
  private async execute(
    action: ManagerAction,
    toolName: string,
    ctx: ToolContext,
    meta: { intent: string; brain: string; acknowledgement?: string | null }
  ): Promise<{ message: ConversationMessage; data?: unknown }> {
    const tool = findTool(toolName);
    if (!tool) {
      if (this.persist) {
        await this.deps.repos.managerActions.update({
          ...action,
          status: "failed",
          error: `Unknown tool ${toolName}`,
          finishedAt: this.now().toISOString(),
        });
      }
      const message = await this.record(action.conversationId!, "manager", `I don't have a "${toolName}" capability.`, {
        intent: meta.intent,
        brain: meta.brain,
      });
      return { message };
    }

    let result: ToolResult;
    let toolStatus: ToolCallRecord["status"] = "succeeded";
    try {
      result = await tool.run(action.params, ctx);
      if (this.persist) {
        await this.deps.repos.managerActions.update({
          ...action,
          status: "succeeded",
          resultSummary: result.speech.slice(0, 500),
          finishedAt: this.now().toISOString(),
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      toolStatus = "failed";
      if (this.persist) {
        await this.deps.repos.managerActions.update({
          ...action,
          status: "failed",
          error: detail,
          finishedAt: this.now().toISOString(),
        });
      }
      // Reported as a failure rather than swallowed — a tool that silently did
      // nothing while the Manager said "done" is the exact failure mode this
      // whole design is trying to avoid.
      result = { speech: `That didn't work: ${detail}` };
    }

    // Every consequential action also lands on the Manager's own activity feed,
    // so the existing team/activity views show Manager work alongside pipeline work.
    if (tool.risk !== "low" && this.persist) {
      await logActivity(this.deps.repos.agentActivity, {
        agentId: "manager",
        action: tool.name,
        summary: action.intentSummary,
        level: toolStatus === "failed" ? "error" : "info",
      });
    }

    const message = await this.record(action.conversationId!, "manager", result.speech, {
      intent: meta.intent,
      brain: meta.brain,
      toolCalls: [{ tool: tool.name, params: action.params, status: toolStatus, summary: result.speech.slice(0, 200) }],
    });
    return { message, data: result.data };
  }

  // -------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------

  async approve(actionId: string, decidedBy = "owner"): Promise<TurnResult | null> {
    const action = await this.deps.repos.managerActions.getById(actionId);
    if (!action || action.status !== "pending_approval") return null;

    const conversation = action.conversationId
      ? await this.deps.repos.conversations.getById(action.conversationId)
      : null;
    if (!conversation) return null;

    const now = this.now().toISOString();
    const approved: ManagerAction = {
      ...action,
      status: "running",
      decidedAt: now,
      decidedBy,
      startedAt: now,
    };
    await this.deps.repos.managerActions.update(approved);

    const ctx: ToolContext = {
      repos: this.deps.repos,
      manager: this.deps.manager,
      commandParser: this.deps.commandParser,
      now: this.now,
      conversationId: conversation.id,
      messageId: action.messageId,
      focusAgentId: conversation.focusAgentId,
    };

    const ownerMessage = await this.record(conversation.id, "owner", "Yes, go ahead.");
    const { message, data } = await this.execute(approved, approved.tool, ctx, {
      intent: "approved",
      brain: this.deps.brain.name,
    });
    await this.touch(conversation);
    return { conversation, ownerMessage, managerMessage: message, pendingAction: null, data };
  }

  async reject(actionId: string, decidedBy = "owner"): Promise<ManagerAction | null> {
    const action = await this.deps.repos.managerActions.getById(actionId);
    if (!action || action.status !== "pending_approval") return null;

    const rejected: ManagerAction = {
      ...action,
      status: "rejected",
      decidedAt: this.now().toISOString(),
      decidedBy,
      finishedAt: this.now().toISOString(),
    };
    await this.deps.repos.managerActions.update(rejected);
    if (action.conversationId) {
      await this.record(action.conversationId, "manager", "Understood — I haven't done it.", {
        intent: "rejected",
        brain: this.deps.brain.name,
      });
    }
    return rejected;
  }

  private async touch(conversation: Conversation): Promise<void> {
    if (!this.persist) return;
    await this.deps.repos.conversations.update({ ...conversation, lastMessageAt: this.now().toISOString() });
  }
}
