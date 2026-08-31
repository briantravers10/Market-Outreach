import type { AgentId } from "../types";
import { getAgentConfigs } from "../config";
import { MANAGER_TOOLS, findTool, resolveAgentId, type ManagerTool, type ToolContext } from "./tools";

/**
 * Choosing which tool to run.
 *
 * The Manager's abilities are the tools in tools.ts, and they are all real. The
 * brain's only job is to map a sentence onto one of them. Two implementations:
 *
 *   RuleBasedManagerBrain — patterns. Works with no API key, no cost, no
 *     network. Handles the request shapes the product is actually built around,
 *     and says plainly when it doesn't understand rather than guessing.
 *
 *   ClaudeManagerBrain — a real Anthropic tool-use call. Handles arbitrary
 *     phrasing. Requires ANTHROPIC_API_KEY.
 *
 * Both run the same tools against the same database, so switching brains changes
 * how well requests are understood, never what the Manager can actually do.
 */

export interface BrainRequest {
  text: string;
  /** Recent turns, oldest first, for pronoun/follow-up resolution. */
  history: { role: "owner" | "manager"; content: string }[];
  focusAgentId: AgentId | null;
}

export interface BrainPlan {
  /** Tool to run, or null when the Manager should just talk. */
  tool: ManagerTool | null;
  params: Record<string, unknown>;
  /** Said before the tool runs — the "one moment" acknowledgement. */
  acknowledgement: string | null;
  /** Used when tool is null. */
  reply: string | null;
  /** Label recorded on the message, for tracing a bad route later. */
  intent: string;
  /** Set when the request should change which employee the conversation is focused on. */
  setFocusAgentId?: AgentId | null;
}

export interface ManagerBrain {
  readonly name: string;
  plan(request: BrainRequest, ctx: ToolContext): Promise<BrainPlan>;
  /**
   * Optional: rephrase a completed tool result in the Manager's own words.
   *
   * The tool has already produced the facts; this only changes how they read.
   * Brains that can't write (the rule-based one) simply omit this and the
   * tool's own wording is used, which is why the Manager still speaks sensibly
   * with no model attached.
   */
  narrate?(input: NarrationRequest): Promise<string>;
}

export interface NarrationRequest {
  /** What the owner actually asked. */
  question: string;
  /** The tool that ran. */
  tool: string;
  /** The tool's factual output — the ONLY source of facts allowed. */
  facts: string;
}

/**
 * Guard against a rephrasing that invents figures.
 *
 * Every digit-sequence in the narration must already appear in the facts.
 * Words like "three" pass freely — the risk being defended against is a
 * confident, specific, wrong number, and that always arrives as digits.
 *
 * Deliberately strict and one-directional: dropping a number is fine
 * (a summary may not mention everything), inventing one is not.
 */
export function numbersAreGrounded(facts: string, narration: string): boolean {
  const digitsIn = (text: string) => (text.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? []);
  const allowed = new Set(digitsIn(facts));
  return digitsIn(narration).every((n) => allowed.has(n));
}

// ---------------------------------------------------------------------------
// Acknowledgements
// ---------------------------------------------------------------------------

/**
 * Short executive-assistant acknowledgements. Varied by a rotating index rather
 * than randomly so the same request in a test always produces the same words,
 * and so the same phrase never lands twice in a row.
 */
const ACKS = ["One moment.", "Checking now.", "Certainly.", "Let me look.", "Right away."];
let ackIndex = 0;
function nextAck(): string {
  const ack = ACKS[ackIndex % ACKS.length];
  ackIndex += 1;
  return ack;
}

/** Reset between tests so acknowledgement order is reproducible. */
export function resetAcknowledgements(): void {
  ackIndex = 0;
}

// ---------------------------------------------------------------------------
// Rule-based brain
// ---------------------------------------------------------------------------

interface Route {
  intent: string;
  test: RegExp;
  /** Rejects a superficially-matching phrase that means something else. */
  reject?: RegExp;
  tool: string;
  params(text: string, req: BrainRequest): Record<string, unknown>;
}

/**
 * Order matters: the first matching route wins, so specific phrasings are
 * listed before general ones.
 */
const ROUTES: Route[] = [
  {
    intent: "talk_to_agent",
    test: /\b(talk|speak|put me through|connect me|switch)\b.*\b(to|with)\b/i,
    tool: "talk_to_agent",
    params: (text) => ({ agent: text }),
  },
  {
    intent: "briefing",
    test: /\b(briefing|brief me|catch me up|give me an update|update me|what'?s new|status update|where are we)\b/i,
    tool: "get_briefing",
    params: (text) => ({ period: text }),
  },
  {
    intent: "revoke_instruction",
    test: /\b(undo|revoke|cancel|forget|remove|drop|reverse|stop following|no longer)\b/i,
    reject: /\b(campaign|schedule|scheduled|report)\b/i,
    tool: "revoke_instruction",
    params: (text, req) => ({ agent: req.focusAgentId ?? text, match: text }),
  },
  {
    intent: "cancel_schedule",
    test: /\b(cancel|stop|remove|turn off)\b.*\b(schedule|scheduled|daily report|weekly report|recurring)\b/i,
    tool: "cancel_scheduled_task",
    params: (text) => ({ match: text }),
  },
  {
    intent: "schedule_report",
    test: /\b(every|each)\b.*\b(morning|day|week|friday|monday|tuesday|wednesday|thursday|saturday|sunday|\d{1,2}\s*(am|pm))\b/i,
    tool: "schedule_report",
    params: (text) => ({ request: text }),
  },
  {
    intent: "give_instruction",
    // "tell the Scout ...", "from now on ...", "for today's search ..."
    test: /\b(tell|instruct|from now on|going forward|permanently|always|never|stop including|don'?t include|only search|for (today|this|that))\b/i,
    tool: "give_instruction",
    params: (text, req) => {
      const permanent = /\b(from now on|going forward|permanently|always|never|anymore|any more|standing)\b/i.test(text);
      const temporary = /\b(for (today|now|this search|this campaign|today'?s)|just (today|this once)|only for|not permanent|don'?t make (that|this) permanent|temporar)\b/i.test(text);
      return {
        agent: req.focusAgentId ?? text,
        instruction: cleanInstruction(text),
        // Ambiguous defaults to temporary: a rule that quietly became permanent
        // is far harder to notice and undo than one that quietly expired.
        scope: permanent && !temporary ? "permanent" : "temporary",
      };
    },
  },
  {
    intent: "list_instructions",
    test: /\b(what|which|show|list).*(instruction|rule|told|said|asked|changed|change)\b/i,
    tool: "list_instructions",
    params: (text, req) => ({
      agent: req.focusAgentId ?? text,
      includeInactive: /\b(history|all|revoked|superseded|past|previous)\b/i.test(text),
      period: text,
      scope: /\bpermanent\b/i.test(text) ? "permanent" : /\btemporar/i.test(text) ? "temporary" : undefined,
    }),
  },
  {
    intent: "explain_lead",
    test: /\bwhy\b.*\b(reject|disqualif|score|scored|qualif|pick|choose|flag)/i,
    reject: /\b(scout|only find|only found)\b/i,
    tool: "explain_lead",
    params: (text) => ({ business: extractQuoted(text) ?? text.replace(/.*\b(business|lead|company)\b/i, "").trim() }),
  },
  {
    intent: "explain_discovery",
    test: /\bwhy\b.*\b(scout|only (find|found|get)|so few|not more)\b/i,
    tool: "get_activity",
    params: (text) => ({ agent: "scout", period: text }),
  },
  {
    intent: "compare_periods",
    test: /\bcompare\b|\bvs\b|\bversus\b|\bagainst last\b/i,
    tool: "compare_periods",
    params: (text) => ({ period: text }),
  },
  {
    intent: "list_reports",
    test: /\b(report|archive)\b/i,
    reject: /\b(generate|write|create|produce|give me a (daily|weekly))\b/i,
    tool: "list_reports",
    params: (text) => ({
      period: text,
      type: /\bweekly\b/i.test(text) ? "weekly" : /\bdaily\b/i.test(text) ? "daily" : undefined,
    }),
  },
  {
    intent: "generate_report",
    test: /\b(generate|write|create|produce|run)\b.*\breport\b/i,
    tool: "generate_report",
    params: (text) => ({ type: /\bweekly\b/i.test(text) ? "weekly" : "daily", period: text }),
  },
  {
    intent: "list_scheduled",
    test: /\b(what|show|list).*(scheduled|schedule|recurring)\b/i,
    tool: "list_scheduled_tasks",
    params: () => ({}),
  },
  {
    intent: "team_status",
    test: /\b(everyone|everybody|all of them|the team|employees?|who'?s working|what are (they|my employees))\b/i,
    reject: /\b(tell|instruct|from now on)\b/i,
    tool: "get_team_status",
    params: () => ({}),
  },
  {
    intent: "list_leads",
    test: /\b(lead|prospect|opportunit|best|top|strongest)\b/i,
    reject: /\bwhy\b/i,
    tool: "list_leads",
    params: (text) => ({
      period: text,
      limit: Number(text.match(/\b(\d{1,2})\b/)?.[1] ?? 5),
      minScore: /\bhigh[\s-]?priority\b/i.test(text) ? 80 : undefined,
    }),
  },
  {
    intent: "start_work",
    test: /\b(find|search for|look for|go get|source|prospect for|hunt)\b/i,
    tool: "start_work",
    params: (text) => ({ request: text }),
  },
  {
    intent: "control_campaign",
    test: /\b(start|pause|resume|stop|run)\b.*(campaign|job|search|it)\b/i,
    tool: "control_campaign",
    params: (text) => ({
      action: /\brun\b.*\bjob\b/i.test(text)
        ? "run_next_job"
        : /\bpause\b/i.test(text)
          ? "pause"
          : /\bresume\b/i.test(text)
            ? "resume"
            : /\bstop\b/i.test(text)
              ? "stop"
              : "start",
      campaign: extractQuoted(text) ?? "",
    }),
  },
  {
    intent: "activity",
    test: /\b(what happened|what did|activity|accomplish|got done|yesterday|last week|this week)\b/i,
    tool: "get_activity",
    params: (text, req) => ({ period: text, agent: req.focusAgentId ?? undefined }),
  },
  {
    intent: "agent_detail",
    test: /\b(scout|researcher|website analyst|qualifier|dedup|reporting|crm)\b/i,
    tool: "get_agent_detail",
    params: (text, req) => ({ agent: req.focusAgentId ?? text }),
  },
];

/** Strips the addressing preamble so the stored instruction reads as the order itself. */
function cleanInstruction(text: string): string {
  const stripped = text
    .replace(/^\s*(manager|hey|ok(ay)?|please)[,\s]+/i, "")
    .replace(/^\s*tell\s+(the\s+)?[a-z\s-]{3,20}?\s+(that\s+|to\s+)?/i, "")
    .replace(/^\s*instruct\s+(the\s+)?[a-z\s-]{3,20}?\s+(to\s+)?/i, "")
    .trim();
  // Removing the addressing clause can leave a dangling infinitive
  // ("tell the Scout to stop X" -> "to stop X"). Read back, the instruction
  // should be the order itself.
  const deInfinitived = stripped.replace(/^to\s+/i, "");
  const result = deInfinitived.charAt(0).toUpperCase() + deInfinitived.slice(1);
  // Never return an empty instruction just because the cleanup was too greedy.
  return result.trim() || text.trim();
}

function extractQuoted(text: string): string | null {
  const m = text.match(/["“']([^"”']{2,})["”']/);
  return m ? m[1] : null;
}

const HELP = [
  "I can tell you what the team is doing, brief you, pull up leads and explain their scores,",
  "give employees permanent or temporary instructions and undo them,",
  "start and run campaigns, generate and archive reports, and set up recurring ones.",
  "Try: \"give me my briefing\", \"what is everyone doing\", \"show me yesterday's best leads\",",
  "or \"tell the Scout to stop including chains from now on\".",
].join(" ");

export class RuleBasedManagerBrain implements ManagerBrain {
  readonly name = "rule-based-v1";

  async plan(request: BrainRequest): Promise<BrainPlan> {
    const text = request.text.trim();
    if (!text) {
      return { tool: null, params: {}, acknowledgement: null, reply: "I'm listening.", intent: "empty" };
    }

    // "That's only for today, don't make it permanent" — a correction to the
    // instruction just given, not a new one. Handled before routing because it
    // reads like an instruction and would otherwise create a second rule.
    if (/\b(only for (today|now)|not permanent|don'?t make (that|it|this) permanent|just (for )?today)\b/i.test(text)) {
      const lastInstruction = [...request.history].reverse().find((h) => h.role === "owner");
      return {
        tool: findTool("give_instruction"),
        params: {
          agent: request.focusAgentId ?? lastInstruction?.content ?? text,
          instruction: cleanInstruction(lastInstruction?.content ?? text),
          scope: "temporary",
        },
        acknowledgement: nextAck(),
        reply: null,
        intent: "downgrade_to_temporary",
      };
    }

    if (/^(hi|hello|hey|thanks|thank you|good (morning|afternoon|evening))\b/i.test(text) && text.length < 30) {
      return {
        tool: null,
        params: {},
        acknowledgement: null,
        reply: "Ready when you are. Ask me for a briefing, or tell me what you'd like the team to do.",
        intent: "greeting",
      };
    }

    if (/\b(what can you do|help|how do (i|you) work|what are your|commands)\b/i.test(text)) {
      return { tool: null, params: {}, acknowledgement: null, reply: HELP, intent: "help" };
    }

    for (const route of ROUTES) {
      if (!route.test.test(text)) continue;
      if (route.reject?.test(text)) continue;
      const tool = findTool(route.tool);
      if (!tool) continue;

      const plan: BrainPlan = {
        tool,
        params: route.params(text, request),
        acknowledgement: nextAck(),
        reply: null,
        intent: route.intent,
      };
      if (route.intent === "talk_to_agent") {
        plan.setFocusAgentId = resolveAgentId(text);
      }
      return plan;
    }

    // No guessing. An unrecognized request that silently ran the wrong tool
    // would be worse than one that admits it didn't understand.
    return {
      tool: null,
      params: {},
      acknowledgement: null,
      reply: `I didn't follow that one. ${HELP}`,
      intent: "unrecognized",
    };
  }
}

// ---------------------------------------------------------------------------
// Claude brain
// ---------------------------------------------------------------------------

/** The HTTP call, injectable so the request/response handling is testable without a key. */
export interface AnthropicTransport {
  send(body: unknown, apiKey: string, model: string): Promise<AnthropicResponse>;
}

export interface AnthropicResponse {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    | { type: string; [k: string]: unknown }
  >;
}

const DEFAULT_MODEL = "claude-sonnet-4-5";

/**
 * What the Manager needs to know about its own deployment.
 *
 * Passed in rather than assumed, because two of these were previously asserted
 * as constants and one of them had become false. The prompt told the model
 * "all business data in this system is synthetic test data" — true when it was
 * written, and by the time seventy-seven thousand real businesses with real
 * phone numbers had been imported, an instruction to tell the owner his live
 * leads were fake.
 */
export interface ManagerContext {
  /** What the owner has named the assistant. Spoken and written. */
  assistantName?: string;
  /** True once an email or SMS provider is configured. */
  canReachBusinesses?: boolean;
  /** False on the public demo snapshot, true on a deployment holding real imports. */
  dataIsReal?: boolean;
}

export function buildSystemPrompt(focusAgentId: AgentId | null, context: ManagerContext = {}): string {
  const roster = getAgentConfigs()
    .map((a) => `- ${a.name} (${a.id}): ${a.description}${a.disabled ? " [DISABLED]" : ""}`)
    .join("\n");

  const name = context.assistantName?.trim() || "Manager";

  return [
    `You are ${name}, running a small prospecting team inside the owner's own tool.`,
    "You are talking to the owner, usually out loud. Talk like a sharp colleague who already knows the business,",
    "not like a customer-service bot.",
    "",
    "How to talk:",
    "- Lead with the answer. The number or the fact first, context after, and only if it helps.",
    "- Two or three sentences unless more is asked for. If he wants detail he will ask, and then give it properly.",
    "- No markdown, bullets, headings or symbols. This is read aloud.",
    "- Never open with 'How can I assist you' or any variant. Never offer help he did not ask for.",
    "- Do not restate his question back to him before answering it.",
    "- Vary your phrasing. Repeating the same opener every turn is what makes an assistant feel like a machine.",
    "- Plain words. 'Found', not 'successfully identified'. 'Nothing yet', not 'no results are currently available'.",
    "",
    "Holding the thread:",
    "- The conversation so far is above. Use it. 'What about yesterday' after a question about today means the",
    "  same question, different day — do not ask him to repeat himself.",
    "- Resolve references from context: 'those leads', 'that report', 'the second one', 'him', 'her', 'that agent',",
    "  'the ones in Miami'. If the reference is genuinely ambiguous, ask which one — but only then.",
    "- Take corrections without ceremony. 'No, I meant Florida' means redo it for Florida; say what changed, briefly,",
    "  and do not apologise at length.",
    "- Informal, clipped and half-finished sentences are normal speech. Work out what he meant.",
    "- He may change the subject without warning. Follow him; do not drag the old topic along.",
    "- Ask a clarifying question only when you genuinely cannot act. A reasonable assumption stated out loud beats",
    "  a question that stops the conversation.",
    "",
    "Your team:",
    roster,
    "",
    focusAgentId
      ? `The owner is currently talking to the ${focusAgentId}. Instructions with no explicit target are for them.`
      : "No specific employee is in focus.",
    "",
    "Rules you must not break:",
    "- Never invent numbers, names, leads or results. Every fact you state must come from a tool result.",
    "- If no tool fits, say what you can do instead. Do not improvise an answer about platform data.",
    "- Distinguish permanent instructions ('from now on') from temporary ones ('for today'). If it is ambiguous, choose temporary and say so.",
    context.canReachBusinesses
      ? "- Sending email or SMS reaches a real business. Never send without explicit approval, and say what will go to whom before asking."
      : "- No email or SMS provider is configured, so nothing here can contact a business. If asked to, say that plainly rather than pretending to send.",
    context.dataIsReal === false
      ? "- This deployment is a read-only demo and every business in it is invented. Never imply the data is real."
      : "- The businesses in this system are REAL, with real phone numbers and addresses, imported from published open data. Never call them samples, test data or examples.",
  ].join("\n");
}

/** Converts the tool registry into the Anthropic tool-use schema. */
export function toolsForApi(tools: ManagerTool[] = MANAGER_TOOLS) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

const fetchTransport: AnthropicTransport = {
  async send(body, apiKey, model) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, ...(body as object) }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Anthropic API ${response.status}: ${detail.slice(0, 300)}`);
    }
    return (await response.json()) as AnthropicResponse;
  },
};

/**
 * Picks the tool with a real model call.
 *
 * NOTE ON TEST STATUS: the request construction, tool schema translation and
 * response handling are unit-tested against an injected transport
 * (scripts/test-manager.ts). The live HTTP call has NOT been exercised, because
 * no ANTHROPIC_API_KEY exists in this project and adding paid API usage without
 * being asked is out of bounds. See NEEDS_OWNER_INPUT.md.
 */
export class ClaudeManagerBrain implements ManagerBrain {
  readonly name = "claude";

  constructor(
    private readonly apiKey: string,
    private readonly transport: AnthropicTransport = fetchTransport,
    private readonly model: string = DEFAULT_MODEL,
    /**
     * What this deployment actually is. Defaults are deliberately the cautious
     * ones: an assistant that wrongly believes it cannot send is harmless,
     * whereas one that wrongly believes it can is not.
     */
    private readonly context: ManagerContext = {}
  ) {}

  buildRequest(request: BrainRequest) {
    return {
      max_tokens: 1024,
      system: buildSystemPrompt(request.focusAgentId, this.context),
      tools: toolsForApi(),
      messages: [
        ...request.history.map((h) => ({
          role: h.role === "owner" ? ("user" as const) : ("assistant" as const),
          content: h.content,
        })),
        { role: "user" as const, content: request.text },
      ],
    };
  }

  /** Pure: turns an API response into a plan. Separated so it can be tested without a network call. */
  interpretResponse(response: AnthropicResponse, request: BrainRequest): BrainPlan {
    const toolUse = response.content.find((c) => c.type === "tool_use") as
      | { type: "tool_use"; name: string; input: Record<string, unknown> }
      | undefined;
    const text = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join(" ")
      .trim();

    if (!toolUse) {
      return {
        tool: null,
        params: {},
        acknowledgement: null,
        reply: text || "I'm not sure how to help with that one.",
        intent: "conversation",
      };
    }

    const tool = findTool(toolUse.name);
    if (!tool) {
      // The model named a tool that doesn't exist. Say so rather than silently
      // dropping the turn.
      return {
        tool: null,
        params: {},
        acknowledgement: null,
        reply: text || `I tried to use a capability I don't have (${toolUse.name}).`,
        intent: "unknown_tool",
      };
    }

    const plan: BrainPlan = {
      tool,
      params: toolUse.input ?? {},
      acknowledgement: text || nextAck(),
      reply: null,
      intent: toolUse.name,
    };
    if (toolUse.name === "talk_to_agent") {
      plan.setFocusAgentId = resolveAgentId(toolUse.input?.agent) ?? request.focusAgentId;
    }
    return plan;
  }

  async plan(request: BrainRequest): Promise<BrainPlan> {
    const response = await this.transport.send(this.buildRequest(request), this.apiKey, this.model);
    return this.interpretResponse(response, request);
  }

  buildNarrationRequest(input: NarrationRequest) {
    return {
      max_tokens: 400,
      system: [
        "You are the Manager of a small AI prospecting team, reporting back to the owner.",
        "You will be given the owner's question and the factual result of running one internal tool.",
        "Rewrite that result as you would say it out loud: brief, plain, professional. Two or three sentences at most.",
        "",
        "Absolute rules:",
        "- Use ONLY the facts given. Never add a number, name, date or claim that is not in them.",
        "- If the facts say nothing happened, say so plainly. Do not soften it or speculate about why.",
        "- Never offer to do something you have not been told you can do.",
        "- No markdown, no bullet points, no headings. This is often read aloud.",
        "- Do not open with a greeting unless the facts begin with one.",
      ].join("\n"),
      messages: [
        {
          role: "user" as const,
          content: [
            `The owner asked: "${input.question}"`,
            `Tool run: ${input.tool}`,
            "",
            "Result:",
            input.facts,
          ].join("\n"),
        },
      ],
    };
  }

  /**
   * Rephrases a tool result, falling back to the tool's own wording whenever
   * the rewrite can't be trusted — an API failure, an empty reply, or a number
   * that wasn't in the source. A stiff sentence is a far better outcome than a
   * fluent invented one.
   */
  async narrate(input: NarrationRequest): Promise<string> {
    try {
      const response = await this.transport.send(this.buildNarrationRequest(input), this.apiKey, this.model);
      const text = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join(" ")
        .trim();

      if (!text) return input.facts;
      if (!numbersAreGrounded(input.facts, text)) return input.facts;
      return text;
    } catch {
      return input.facts;
    }
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface BrainDescription {
  brain: ManagerBrain;
  name: string;
  /** Shown in the UI so the owner always knows which one answered. */
  detail: string;
  usingLlm: boolean;
}

/**
 * Picks a brain from the environment.
 *
 * Falls back rather than failing: with no key the Manager is still fully
 * functional for the request shapes the rule router covers, which is the point
 * of keeping competence in the tools.
 */
export function selectBrain(
  env: NodeJS.ProcessEnv = process.env,
  context: ManagerContext = {}
): BrainDescription {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (key) {
    return {
      brain: new ClaudeManagerBrain(key, fetchTransport, env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL, context),
      name: "claude",
      detail: "Claude is interpreting your requests, so phrasing can be free-form.",
      usingLlm: true,
    };
  }
  return {
    brain: new RuleBasedManagerBrain(),
    name: "rule-based-v1",
    detail:
      "No language model is connected, so I'm matching your words against known request shapes. " +
      "Everything I report is real; I just understand fewer ways of asking. Set ANTHROPIC_API_KEY to change that.",
    usingLlm: false,
  };
}
