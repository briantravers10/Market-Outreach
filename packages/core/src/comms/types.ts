import type { ActionRisk } from "../manager/types";

/**
 * The Communications Centre.
 *
 * A tool the Manager uses, not another AI employee. Everything outbound goes
 * through here so there is exactly one place that knows how to reach someone,
 * one place that records what was sent, and one gate that sending has to pass.
 *
 * THE RULE: a Communication is created as a draft and only ever becomes `sent`
 * by way of an explicit human approval. Nothing in this module may send on its
 * own initiative, and the type system is arranged so that skipping the approval
 * step means skipping a required argument rather than forgetting a check.
 */

export type CommunicationChannel = "email" | "sms";

export type CommunicationDirection = "outbound" | "inbound";

/**
 * Where a communication is in its life.
 *
 * `draft` and `awaiting_approval` are deliberately distinct. A draft is
 * something the Manager wrote and nobody has been asked about; awaiting
 * approval means the owner has been shown it and the question is open. Merging
 * them would lose the difference between "I wrote this for later" and "I am
 * waiting on you", which is exactly what the Communications Centre exists to
 * show at a glance.
 */
export type CommunicationStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled"
  | "received";

export interface Communication {
  id: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  status: CommunicationStatus;

  /** Display name of the human, as resolved. Never invented — null when unknown. */
  contactName: string | null;
  /** The organisation, where one applies. */
  businessName: string | null;
  /** Email address or E.164 phone number. The single field that decides who actually receives this. */
  destination: string;
  /** Who it is from, once a provider has been chosen. Null until then. */
  sender: string | null;

  /** Email only. */
  subject: string | null;
  body: string;

  /** Set the moment a human approves, and never set by anything else. */
  approvedAt: string | null;
  approvedBy: string | null;
  /** For a scheduled send: when it should go. Null for send-now. */
  scheduledFor: string | null;
  sentAt: string | null;
  /** The provider's own id, so a delivery webhook can find this row again. */
  providerMessageId: string | null;
  provider: string | null;
  error: string | null;

  /** Ties the message back to the conversation that produced it, for "what did I ask you to do". */
  conversationId: string | null;
  /** The approval record in manager_actions, so the audit trail joins up. */
  actionId: string | null;
  /** Our own lead, where the recipient is one. */
  leadId: string | null;
  /** Pipedrive ids, so history can be reconciled with the CRM rather than duplicated. */
  pipedrivePersonId: number | null;
  pipedriveOrgId: number | null;
  pipedriveDealId: number | null;
  /** The activity we logged in Pipedrive for this message, if we managed to. */
  pipedriveActivityId: number | null;

  /** For a reply: the message it answers. */
  inReplyToId: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface CommunicationFilter {
  channel?: CommunicationChannel;
  direction?: CommunicationDirection;
  status?: CommunicationStatus;
  /** Anything not yet sent or cancelled — what the owner actually needs to look at. */
  openOnly?: boolean;
  contactName?: string;
  businessName?: string;
  destination?: string;
  leadId?: string;
  conversationId?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface CommunicationsRepository {
  create(communication: Communication): Promise<Communication>;
  update(communication: Communication): Promise<Communication>;
  getById(id: string): Promise<Communication | null>;
  list(filter?: CommunicationFilter): Promise<Communication[]>;
  count(filter?: CommunicationFilter): Promise<number>;
  /** Used by delivery and reply webhooks, which know the provider's id and nothing else. */
  findByProviderMessageId(providerMessageId: string): Promise<Communication | null>;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface SendResult {
  ok: boolean;
  providerMessageId: string | null;
  provider: string;
  error: string | null;
}

/**
 * Why a provider cannot send, in the owner's terms.
 *
 * Distinct from a send failure: "no API key configured" is a setup task, and
 * "the recipient's mailbox is full" is an operational one. Reporting the first
 * as the second sends someone to check the wrong thing.
 */
export interface ProviderReadiness {
  ready: boolean;
  provider: string;
  /** What is missing, naming the environment variable where that is the answer. */
  explanation: string;
  missing: string[];
}

export interface EmailProvider {
  readonly name: string;
  readiness(): ProviderReadiness;
  send(message: { to: string; subject: string; body: string; replyTo?: string }): Promise<SendResult>;
}

export interface SmsProvider {
  readonly name: string;
  readiness(): ProviderReadiness;
  send(message: { to: string; body: string }): Promise<SendResult>;
}

// ---------------------------------------------------------------------------
// Contact resolution
// ---------------------------------------------------------------------------

/** One possible recipient, with enough context for a human to tell it apart from another. */
export interface ContactCandidate {
  name: string;
  businessName: string | null;
  email: string | null;
  phone: string | null;
  /** Where this came from — "Pipedrive person 412", "lead a1b2". Shown so a choice can be checked. */
  source: string;
  pipedrivePersonId: number | null;
  pipedriveOrgId: number | null;
  leadId: string | null;
}

/**
 * The result of asking "who is John?".
 *
 * `ambiguous` is a first-class outcome rather than an error, because the
 * correct behaviour when two people match is to ask — not to pick the first, and
 * not to fail. Messaging the wrong person is the one mistake in this system
 * that cannot be undone.
 */
export type ContactResolution =
  | { kind: "resolved"; contact: ContactCandidate }
  | { kind: "ambiguous"; candidates: ContactCandidate[]; query: string }
  | { kind: "not_found"; query: string }
  | { kind: "unreachable"; contact: ContactCandidate; channel: CommunicationChannel };

/** Risk of a communications action, so the Manager's existing approval gate can classify it. */
export const COMMS_RISK: Record<string, ActionRisk> = {
  draft: "low",
  send: "high",
  bulk: "high",
};
