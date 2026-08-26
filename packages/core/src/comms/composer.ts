import type { CommunicationChannel } from "./types";

/**
 * Writing the actual words of an email or text.
 *
 * Kept separate from the tools so it can be swapped for a model-written version
 * without touching the approval flow — and so the fallback is honest. With no
 * language model configured the Manager still drafts something sensible and
 * says plainly that it is a starting point; it does not pretend to have
 * composed something bespoke.
 */

export interface ComposeRequest {
  channel: CommunicationChannel;
  /** What the owner asked for, verbatim: "ask if he's available Wednesday at 3". */
  intent: string;
  contactName: string | null;
  businessName: string | null;
  /** How the owner signs off. */
  senderName: string | null;
  /** Anything known about them worth referencing — booking setup, website state. */
  context?: string | null;
}

export interface ComposedMessage {
  subject: string | null;
  body: string;
  /** True when a model wrote it; false when this is the built-in fallback. */
  bespoke: boolean;
}

/** A model that can write. Optional — the Manager works without one. */
export interface MessageComposer {
  compose(request: ComposeRequest): Promise<ComposedMessage>;
}

function greetingFor(contactName: string | null, businessName: string | null): string {
  if (contactName && !contactName.includes("(")) {
    // Pipedrive gives full names; a first name reads like a person wrote it.
    const first = contactName.trim().split(/\s+/)[0];
    if (first && first.length > 1) return `Hi ${first},`;
  }
  if (businessName) return `Hi ${businessName},`;
  return "Hi,";
}

/**
 * The no-model fallback.
 *
 * Deliberately plain. It puts the owner's own words in as the substance rather
 * than padding around them, because a short honest note the owner then edits is
 * more useful than a polished template that says nothing they meant.
 */
export function composeFallback(request: ComposeRequest): ComposedMessage {
  const greeting = greetingFor(request.contactName, request.businessName);
  const signOff = request.senderName ? `\n\nThanks,\n${request.senderName}` : "\n\nThanks";

  if (request.channel === "sms") {
    // No greeting block, no sign-off paragraph — a text that reads like an
    // email is the single most obvious sign nobody wrote it.
    const name = request.contactName?.trim().split(/\s+/)[0];
    const opener = name ? `Hi ${name}, ` : "";
    return { subject: null, body: `${opener}${request.intent.trim()}`.slice(0, 320), bespoke: false };
  }

  const subject = request.businessName
    ? `Quick question — ${request.businessName}`
    : "Quick question";

  return {
    subject,
    body: `${greeting}\n\n${request.intent.trim()}${signOff}`,
    bespoke: false,
  };
}

export async function composeMessage(
  request: ComposeRequest,
  composer: MessageComposer | null
): Promise<ComposedMessage> {
  if (!composer) return composeFallback(request);
  try {
    return await composer.compose(request);
  } catch {
    // A model outage must not block drafting. The fallback is worse writing,
    // not a worse outcome — and the owner can revise either way.
    return composeFallback(request);
  }
}
