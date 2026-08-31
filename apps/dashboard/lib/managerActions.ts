"use server";

import { revalidatePath } from "next/cache";
import { getAiManager, getBrainDescription } from "./managerData";
import { getRepos, getVoiceSettings } from "./data";
import { isDemoMode } from "./demo";

/**
 * Server actions for the Manager.
 *
 * These are called from the floating assistant (a client component), so unlike
 * the rest of the dashboard they return values rather than only revalidating.
 *
 * Read-only requests are allowed in demo mode so the assistant is explorable on
 * the public deploy; anything that would write is refused there and says so,
 * rather than appearing to work.
 */

export interface ChatReply {
  conversationId: string;
  reply: string;
  /** Set when the Manager is waiting for a yes/no before doing something. */
  pendingActionId: string | null;
  pendingSummary: string | null;
  /** Which brain answered — displayed so the owner knows what they're talking to. */
  brain: string;
  usingLlm: boolean;
  error?: string;
}

/** Pages whose contents a Manager action can change. */
function revalidateManagerViews(): void {
  for (const path of [
    "/manager",
    "/manager/activity",
    "/manager/instructions",
    "/manager/reports",
    "/manager/scheduled",
    "/manager/memory",
    "/team",
    "/overview",
    "/campaigns",
    "/leads",
  ]) {
    revalidatePath(path);
  }
}

/**
 * The assistant's own name, for the prompt.
 *
 * Read here rather than threaded through every caller: the name is a display
 * and prompt concern, not part of any action's contract, and a failure to read
 * it must never stop a message being answered.
 */
async function assistantName(): Promise<string | undefined> {
  try {
    return (await getVoiceSettings()).assistantName;
  } catch {
    return undefined;
  }
}

export async function sendManagerMessage(text: string, conversationId?: string): Promise<ChatReply> {
  const brain = getBrainDescription(await assistantName());
  const trimmed = text.trim();

  if (!trimmed) {
    return {
      conversationId: conversationId ?? "",
      reply: "I'm listening.",
      pendingActionId: null,
      pendingSummary: null,
      brain: brain.name,
      usingLlm: brain.usingLlm,
    };
  }

  try {
    const manager = getAiManager(await assistantName());
    const turn = await manager.handle(trimmed, conversationId);

    // The demo database is read-only, so a consequential action could never
    // complete. Say that up front instead of letting an approval fail later.
    if (turn.pendingAction && isDemoMode) {
      return {
        conversationId: turn.conversation.id,
        reply: `${turn.pendingAction.intentSummary} — but this is the read-only demo, so I can't actually make changes here.`,
        pendingActionId: null,
        pendingSummary: null,
        brain: brain.name,
        usingLlm: brain.usingLlm,
      };
    }

    revalidateManagerViews();
    return {
      conversationId: turn.conversation.id,
      reply: turn.managerMessage.content,
      pendingActionId: turn.pendingAction?.id ?? null,
      pendingSummary: turn.pendingAction?.intentSummary ?? null,
      brain: brain.name,
      usingLlm: brain.usingLlm,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      conversationId: conversationId ?? "",
      reply: "Something went wrong on my end and I couldn't complete that.",
      pendingActionId: null,
      pendingSummary: null,
      brain: brain.name,
      usingLlm: brain.usingLlm,
      error: detail,
    };
  }
}

export async function approveManagerAction(actionId: string): Promise<ChatReply> {
  const brain = getBrainDescription(await assistantName());
  if (isDemoMode) {
    return {
      conversationId: "",
      reply: "This is the read-only demo — I can't make changes here.",
      pendingActionId: null,
      pendingSummary: null,
      brain: brain.name,
      usingLlm: brain.usingLlm,
    };
  }

  const result = await getAiManager(await assistantName()).approve(actionId);
  revalidateManagerViews();
  if (!result) {
    return {
      conversationId: "",
      reply: "That request has already been dealt with.",
      pendingActionId: null,
      pendingSummary: null,
      brain: brain.name,
      usingLlm: brain.usingLlm,
    };
  }
  return {
    conversationId: result.conversation.id,
    reply: result.managerMessage.content,
    pendingActionId: null,
    pendingSummary: null,
    brain: brain.name,
    usingLlm: brain.usingLlm,
  };
}

export async function rejectManagerAction(actionId: string): Promise<ChatReply> {
  const brain = getBrainDescription(await assistantName());
  if (isDemoMode) {
    return {
      conversationId: "",
      reply: "Nothing to undo — this is the read-only demo.",
      pendingActionId: null,
      pendingSummary: null,
      brain: brain.name,
      usingLlm: brain.usingLlm,
    };
  }
  await getAiManager().reject(actionId);
  revalidateManagerViews();
  return {
    conversationId: "",
    reply: "Understood — I haven't done it.",
    pendingActionId: null,
    pendingSummary: null,
    brain: brain.name,
    usingLlm: brain.usingLlm,
  };
}

/** Loads a conversation's transcript so the assistant can be reopened mid-thread. */
export async function loadConversation(conversationId: string) {
  const messages = await getRepos().conversations.listMessages(conversationId, 100);
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
  }));
}

/** The most recent conversation id, so reopening the assistant resumes rather than restarts. */
export async function latestConversationId(): Promise<string | null> {
  const [latest] = await getRepos().conversations.list(1);
  return latest?.id ?? null;
}
