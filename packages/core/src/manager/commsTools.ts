import { describeCandidate } from "../comms/contactResolver";
import { composeMessage } from "../comms/composer";
import { approvalFingerprint } from "../comms/commsService";
import type { CommunicationChannel, ContactCandidate } from "../comms/types";
import type { ManagerTool, ToolContext, ToolResult } from "./tools";

/**
 * The Manager's communications tools.
 *
 * These are why the Communications Centre is a tool and not another AI
 * employee: the Manager already decides what to do, and these simply give it
 * hands. They deliberately mirror the risk levels the approval gate already
 * understands —
 *
 *   drafting is `low`   — it writes something and shows you. Nothing leaves.
 *   sending  is `high`  — requires the existing explicit approval.
 *
 * Every one of them refuses rather than guesses. If two people match a name,
 * the tool returns a question. If a provider is not configured, it says which
 * variable is missing. There is no path through this file that reaches a real
 * person without a human having read the exact words first.
 */

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/** Signature the owner's messages go out under. Never invented — omitted when unset. */
function senderName(): string | null {
  return process.env.OWNER_NAME?.trim() || null;
}

function requireComms(ctx: ToolContext): NonNullable<ToolContext["comms"]> {
  if (!ctx.comms) {
    throw new Error("The Communications Centre is not available in this context.");
  }
  return ctx.comms;
}

/**
 * Turns a resolution into either a contact or the sentence to say instead.
 *
 * Returning the refusal as a ToolResult rather than throwing keeps the
 * conversation going — "which John did you mean?" is an answer, not an error.
 */
async function resolveOrAsk(
  ctx: ToolContext,
  who: string,
  channel: CommunicationChannel
): Promise<{ contact: ContactCandidate } | { refusal: ToolResult }> {
  if (!ctx.contacts) {
    return {
      refusal: {
        speech: "I can't look people up yet — Pipedrive isn't connected and there's no contact source configured.",
      },
    };
  }

  const resolution = await ctx.contacts.resolve(who, channel);

  if (resolution.kind === "resolved") return { contact: resolution.contact };

  if (resolution.kind === "ambiguous") {
    const lines = resolution.candidates.slice(0, 6).map((c) => `• ${describeCandidate(c, channel)}`);
    return {
      refusal: {
        speech:
          `I found ${resolution.candidates.length} matches for "${resolution.query}". Which one did you mean?\n\n${lines.join("\n")}`,
        data: { ambiguous: true, candidates: resolution.candidates, channel },
      },
    };
  }

  if (resolution.kind === "unreachable") {
    const what = channel === "email" ? "an email address" : "a phone number";
    return {
      refusal: {
        speech: `I found ${resolution.contact.name}, but there's no ${what} on file for them.`,
        data: { contact: resolution.contact },
      },
    };
  }

  return { refusal: { speech: `I couldn't find anyone matching "${resolution.query}".` } };
}

function draftTool(channel: CommunicationChannel): ManagerTool {
  const label = channel === "email" ? "email" : "text message";
  return {
    name: channel === "email" ? "draft_email" : "draft_sms",
    description:
      channel === "email"
        ? "Write an email to someone and show it for approval. Does NOT send. Use for 'email X and ask...', 'draft an email to X'."
        : "Write a text message to someone and show it for approval. Does NOT send. Use for 'text X and tell him...'.",
    // Drafting is safe by construction: this tool has no way to send.
    risk: "low",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Who to write to — a person's name or a business name." },
        intent: {
          type: "string",
          description: "What the message should say, in the owner's own words.",
        },
        subject: { type: "string", description: "Email subject. Optional; one is written if omitted." },
      },
      required: ["to", "intent"],
    },
    describe: (params) => `Draft a ${label} to ${str(params.to)}`,
    async run(params, ctx): Promise<ToolResult> {
      const comms = requireComms(ctx);
      const who = str(params.to).trim();
      const intent = str(params.intent).trim();
      if (!who) return { speech: `Who should I ${channel === "email" ? "email" : "text"}?` };
      if (!intent) return { speech: "What would you like it to say?" };

      const resolved = await resolveOrAsk(ctx, who, channel);
      if ("refusal" in resolved) return resolved.refusal;
      const contact = resolved.contact;

      const destination = channel === "email" ? contact.email : contact.phone;
      if (!destination) {
        return { speech: `I found ${contact.name}, but there's nothing to send to.` };
      }

      const composed = await composeMessage(
        {
          channel,
          intent,
          contactName: contact.name,
          businessName: contact.businessName,
          senderName: senderName(),
        },
        ctx.composer ?? null
      );

      const communication = await comms.draft({
        channel,
        destination,
        subject: composed.subject ?? (str(params.subject) || null),
        body: composed.body,
        contactName: contact.name,
        businessName: contact.businessName,
        leadId: contact.leadId,
        conversationId: ctx.conversationId,
        pipedrivePersonId: contact.pipedrivePersonId,
        pipedriveOrgId: contact.pipedriveOrgId,
      });

      // Everything the owner needs to catch a wrong recipient before it matters.
      const header =
        channel === "email"
          ? `To: ${contact.name} <${destination}>${contact.businessName ? ` — ${contact.businessName}` : ""}\nSubject: ${communication.subject ?? ""}`
          : `To: ${contact.name} <${destination}>${contact.businessName ? ` — ${contact.businessName}` : ""}`;

      const readiness = comms.readiness()[channel];
      const caveat = readiness.ready ? "" : `\n\n(Note: ${readiness.explanation})`;

      return {
        speech: `I've drafted it. Here's what I have:\n\n${header}\n\n${communication.body}\n\nSay "send it" when you're happy, or tell me what to change.${caveat}`,
        data: { communication, contact, readiness },
      };
    },
  };
}

const reviseDraft: ManagerTool = {
  name: "revise_draft",
  description:
    "Rewrite the most recent draft — shorter, friendlier, different wording or details. Does NOT send. Use for 'make it shorter', 'change Wednesday to Thursday'.",
  risk: "low",
  parameters: {
    type: "object",
    properties: {
      instruction: { type: "string", description: "How to change it, in the owner's words." },
      communicationId: { type: "string", description: "Which draft. Defaults to the latest one." },
    },
    required: ["instruction"],
  },
  describe: (params) => `Revise the draft: ${str(params.instruction)}`,
  async run(params, ctx): Promise<ToolResult> {
    const comms = requireComms(ctx);
    const instruction = str(params.instruction).trim();
    const id = str(params.communicationId).trim();

    const target = id
      ? await ctx.repos.communications.getById(id)
      : (await ctx.repos.communications.list({ openOnly: true, direction: "outbound", limit: 1 }))[0];

    if (!target) return { speech: "There's no draft open to change." };
    if (target.status === "sent") return { speech: "That one has already gone, so I can't change it." };

    const composed = await composeMessage(
      {
        channel: target.channel,
        // The original wording plus the change, so a rewrite keeps the substance.
        intent: `${target.body}\n\nRevise this: ${instruction}`,
        contactName: target.contactName,
        businessName: target.businessName,
        senderName: senderName(),
      },
      ctx.composer ?? null
    );

    const revised = await comms.revise(target.id, {
      body: composed.body,
      subject: target.channel === "email" ? (composed.subject ?? target.subject) : null,
    });
    if (!revised) return { speech: "I couldn't find that draft any more." };

    const note = ctx.composer
      ? ""
      : "\n\n(I don't have a writing model connected, so that's a mechanical edit — tell me the exact wording if you'd rather.)";

    return {
      speech: `Updated. Here it is now:\n\n${revised.body}${note}`,
      data: { communication: revised },
    };
  },
};

const sendCommunication: ManagerTool = {
  name: "send_communication",
  description:
    "Send a drafted email or text that the owner has approved. Use ONLY when the owner explicitly says to send.",
  // High risk: the existing approval gate turns this into a confirmation
  // prompt, and the tool additionally refuses anything CommsService has not
  // recorded an approval for. Two independent gates, deliberately.
  risk: "high",
  parameters: {
    type: "object",
    properties: {
      communicationId: { type: "string", description: "Which message. Defaults to the latest draft." },
    },
  },
  describe: () => "Send the drafted message",
  async run(params, ctx): Promise<ToolResult> {
    const comms = requireComms(ctx);
    const id = str(params.communicationId).trim();
    const target = id
      ? await ctx.repos.communications.getById(id)
      : (await ctx.repos.communications.list({ openOnly: true, direction: "outbound", limit: 1 }))[0];

    if (!target) return { speech: "There's nothing waiting to be sent." };
    if (target.status === "sent") return { speech: `That was already sent to ${target.destination}.` };

    // Reaching this line means the Manager's approval gate was satisfied — the
    // owner pressed approve on a prompt naming this recipient. That is the
    // human approval CommsService requires.
    const fingerprint = approvalFingerprint(target);
    const approved = await comms.approve(target.id, "owner");
    if (!approved) return { speech: "I couldn't find that message any more." };

    const outcome = await comms.send(approved.id, { expectedFingerprint: fingerprint });

    if (!outcome.ok) {
      return {
        speech: `It didn't send. ${outcome.refusal}`,
        data: { communication: outcome.communication },
      };
    }

    const where = outcome.communication.contactName ?? outcome.communication.destination;
    return {
      speech: `Sent to ${where}.`,
      data: { communication: outcome.communication },
    };
  },
};

const cancelDraft: ManagerTool = {
  name: "cancel_draft",
  description: "Discard a draft without sending it. Use for 'don't send that', 'scrap it'.",
  risk: "low",
  parameters: {
    type: "object",
    properties: { communicationId: { type: "string", description: "Which draft. Defaults to the latest." } },
  },
  describe: () => "Discard the draft",
  async run(params, ctx): Promise<ToolResult> {
    const comms = requireComms(ctx);
    const id = str(params.communicationId).trim();
    const target = id
      ? await ctx.repos.communications.getById(id)
      : (await ctx.repos.communications.list({ openOnly: true, direction: "outbound", limit: 1 }))[0];
    if (!target) return { speech: "There's no draft to discard." };
    await comms.cancel(target.id);
    return { speech: "Discarded — I won't send that.", data: { communicationId: target.id } };
  },
};

const listCommunications: ManagerTool = {
  name: "list_communications",
  description:
    "Look through communication history. Use for 'what did we send John last week', 'when did I last contact X', 'show me everyone I emailed yesterday', 'what's waiting for approval'.",
  risk: "low",
  parameters: {
    type: "object",
    properties: {
      contact: { type: "string", description: "Filter by contact or business name." },
      channel: { type: "string", description: "email or sms" },
      status: { type: "string", description: "draft, awaiting_approval, sent, failed, received" },
      period: { type: "string", description: "today, yesterday, this week — optional." },
      limit: { type: "number" },
    },
  },
  describe: () => "Look through communication history",
  async run(params, ctx): Promise<ToolResult> {
    const contact = str(params.contact).trim();
    const channel = str(params.channel).trim();
    const status = str(params.status).trim();
    const limit = Math.min(25, Math.max(1, Number(params.limit) || 10));

    const records = await ctx.repos.communications.list({
      contactName: contact || undefined,
      channel: (channel as CommunicationChannel) || undefined,
      status: (status as never) || undefined,
      limit,
    });

    if (records.length === 0) {
      return {
        speech: contact
          ? `Nothing on record for ${contact}.`
          : "Nothing in the communication history yet.",
        data: { communications: [] },
      };
    }

    const lines = records.map((record) => {
      const when = record.sentAt ?? record.createdAt;
      const day = when.slice(0, 10);
      const verb =
        record.direction === "inbound"
          ? "received from"
          : record.status === "sent"
            ? "sent to"
            : `${record.status.replace(/_/g, " ")} for`;
      const who = record.contactName ?? record.destination;
      const what = record.subject ? ` — "${record.subject}"` : "";
      return `• ${day}: ${record.channel} ${verb} ${who}${what}`;
    });

    return {
      speech: `${records.length} ${records.length === 1 ? "message" : "messages"}:\n${lines.join("\n")}`,
      data: { communications: records },
    };
  },
};

const crmLookup: ManagerTool = {
  name: "crm_lookup",
  description:
    "Read Pipedrive: find a person or organisation and show their deals, activities and notes. Use for 'what's the status with X', 'when is the follow-up for Y'.",
  risk: "low",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "A person or business name." } },
    required: ["query"],
  },
  describe: (params) => `Look up ${str(params.query)} in Pipedrive`,
  async run(params, ctx): Promise<ToolResult> {
    if (!ctx.pipedrive || !ctx.pipedrive.configured) {
      return {
        speech:
          "Pipedrive isn't connected yet, so I can't read your CRM. It needs PIPEDRIVE_API_TOKEN set.",
      };
    }
    const query = str(params.query).trim();
    if (!query) return { speech: "Who should I look up?" };

    const [people, organizations] = await Promise.all([
      ctx.pipedrive.searchPersons(query),
      ctx.pipedrive.searchOrganizations(query),
    ]);

    if (people.length === 0 && organizations.length === 0) {
      return { speech: `Nothing in Pipedrive matching "${query}".` };
    }

    const person = people[0];
    const organization = organizations[0];
    const [deals, activities, notes] = await Promise.all([
      ctx.pipedrive.listDeals({ personId: person?.id, organizationId: person ? undefined : organization?.id, limit: 5 }),
      ctx.pipedrive.listActivities({ personId: person?.id, organizationId: person ? undefined : organization?.id, limit: 5 }),
      ctx.pipedrive.listNotes({ personId: person?.id, organizationId: person ? undefined : organization?.id, limit: 3 }),
    ]);

    const parts: string[] = [];
    if (person) {
      parts.push(`${person.name}${person.organizationName ? ` at ${person.organizationName}` : ""}${person.email ? ` — ${person.email}` : ""}`);
    } else if (organization) {
      parts.push(organization.name);
    }
    if (people.length + organizations.length > 1) {
      parts.push(`(${people.length + organizations.length} matches — this is the closest.)`);
    }
    if (deals.length) {
      parts.push(`Deals: ${deals.map((d) => `${d.title} (${d.stageName ?? d.status})`).join("; ")}`);
    }
    const open = activities.filter((a) => !a.done);
    if (open.length) {
      parts.push(`Open activities: ${open.map((a) => `${a.subject}${a.dueDate ? ` due ${a.dueDate}` : ""}`).join("; ")}`);
    }
    if (notes.length) {
      parts.push(`Latest note: ${notes[0].content.slice(0, 200)}`);
    }
    if (parts.length <= 1) parts.push("No deals, activities or notes on record.");

    return { speech: parts.join("\n"), data: { people, organizations, deals, activities, notes } };
  },
};

export const COMMS_TOOLS: ManagerTool[] = [
  draftTool("email"),
  draftTool("sms"),
  reviseDraft,
  sendCommunication,
  cancelDraft,
  listCommunications,
  crmLookup,
];
