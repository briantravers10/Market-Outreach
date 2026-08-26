import { randomUUID } from "node:crypto";
import type { AgentId, Lead, Repositories } from "../types";
// Type-only in the other direction, so this pair is not a runtime cycle.
import { COMMS_TOOLS } from "./commsTools";
import { getAgentConfigs, getTerritories } from "../config";
import { summarizeAgent, summarizeAllAgents } from "../agents/agentRegistry";
import type { ProspectingManager } from "../prospectingManager";
import type { CommandParser } from "../nlp/commandParser";
import { describeEffect, parseInstructionEffect } from "./instructionEffects";
import { computeMetrics, generateReport, writeSummary } from "./reporting";
import { nextRunAt, parsePeriod, parseSchedule, rollingWeek, today, yesterday, withinPeriod, type Period } from "./periods";
import type { ActionRisk, AgentInstruction, Report, ReportType, ScheduledTask } from "./types";

/**
 * The Manager's tools.
 *
 * This is where the Manager's competence actually lives. Each tool is ordinary
 * code that really reads or changes the platform — no tool returns invented
 * data, and none of them is a placeholder.
 *
 * The language model, when one is configured, does exactly one job: pick which
 * of these to run and with what arguments. That is why the Manager still works
 * without an API key — a deterministic router picks instead, less flexibly, and
 * the same real tools execute either way. See brain.ts.
 */

export interface ToolContext {
  repos: Repositories;
  manager: ProspectingManager;
  commandParser: CommandParser;
  /** Injected so tests and scheduled runs resolve "yesterday" deterministically. */
  now: () => Date;
  conversationId: string | null;
  messageId: string | null;
  /** The employee the conversation is currently focused on, if any. */
  focusAgentId: AgentId | null;

  /**
   * The Communications Centre, when one is wired up.
   *
   * Optional so every existing tool, test and scheduled run keeps working
   * untouched — and so a context that deliberately has no ability to send (a
   * read-only demo, a scheduled report) is expressed by the absence of the
   * capability rather than by a flag someone can forget to check.
   */
  comms?: import("../comms/commsService").CommsService | null;
  contacts?: import("../comms/contactResolver").ContactResolver | null;
  pipedrive?: import("../crm/pipedriveReader").PipedriveReader | null;
  /** Writes message bodies when a language model is available. */
  composer?: import("../comms/composer").MessageComposer | null;
}

export interface ToolResult {
  /** What the Manager says. Written to be read aloud as well as displayed. */
  speech: string;
  /** Structured payload for the UI to render. Never required for the speech to make sense. */
  data?: unknown;
}

export interface ManagerTool {
  name: string;
  /** Written for a language model to choose from. */
  description: string;
  risk: ActionRisk;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** What running this will do, in the owner's terms. Shown when approval is needed. */
  describe(params: Record<string, unknown>, ctx: ToolContext): string;
  run(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Which employee an instruction belongs to, deduced from what it would do.
 * Returns null for advisory instructions — there is nothing to deduce from, and
 * guessing would put a standing rule on an employee who never asked for it.
 */
function agentForEffect(effect: ReturnType<typeof parseInstructionEffect>): AgentId | null {
  if (!effect) return null;
  switch (effect.kind) {
    case "exclude_name_patterns":
    case "restrict_cities":
      return "scout";
    case "score_adjust":
    case "min_score_threshold":
      return "qualifier";
  }
}

function agentName(agentId: string): string {
  return getAgentConfigs().find((a) => a.id === agentId)?.name ?? agentId;
}

export function resolveAgentId(raw: unknown): AgentId | null {
  const text = str(raw).toLowerCase().trim();
  if (!text) return null;
  const configs = getAgentConfigs();
  const exact = configs.find((a) => a.id === text);
  if (exact) return exact.id as AgentId;
  const byName = configs.find(
    (a) => a.name.toLowerCase() === text || a.name.toLowerCase().replace(/[^a-z]/g, "") === text.replace(/[^a-z]/g, "")
  );
  if (byName) return byName.id as AgentId;
  // Loose contains-match, so "the website analyst" and "dedup" both land.
  const loose = configs.find((a) => text.includes(a.id) || text.includes(a.name.toLowerCase()));
  if (loose) return loose.id as AgentId;
  if (/dedup/.test(text)) return "deduplication";
  return null;
}

/** Resolves a period from an explicit param, else free text, else a default. */
function periodFrom(params: Record<string, unknown>, ctx: ToolContext, fallback: (now: Date) => Period): Period {
  const now = ctx.now();
  const explicit = str(params.period);
  if (explicit) {
    const parsed = parsePeriod(explicit, now);
    if (parsed) return parsed;
  }
  return fallback(now);
}

function formatLeadLine(lead: Lead): string {
  const score = lead.prospectScore ?? 0;
  const bits = [
    lead.websiteStatus === "NONE" ? "no website" : null,
    lead.onlineBookingStatus === "NONE" ? "no online booking" : null,
    lead.bookingMethod === "PHONE_ONLY" ? "phone-only" : null,
  ].filter(Boolean);
  return `${lead.businessName} (${lead.city}) — ${score}${bits.length ? `, ${bits.join(", ")}` : ""}`;
}

// ---------------------------------------------------------------------------
// Read-only tools (risk: low — run without asking)
// ---------------------------------------------------------------------------

const getTeamStatus: ManagerTool = {
  name: "get_team_status",
  description:
    "Report what every AI employee is doing right now: working or idle, their current task, and how much they have processed. Use for 'what is everyone doing', 'what are my employees working on', 'give me a status'.",
  risk: "low",
  parameters: { type: "object", properties: {} },
  describe: () => "Check what every employee is currently doing.",
  async run(_params, ctx) {
    const summaries = await summarizeAllAgents(ctx.repos.agentActivity, ctx.repos.humanReview);
    const active = summaries.filter((s) => s.status === "working");
    const lines = summaries.map((s) => {
      const state =
        s.status === "disabled"
          ? "Disabled"
          : s.status === "working"
            ? `Working — ${s.currentTask ?? "task in progress"}`
            : s.lastCompletedTask
              ? `Idle — last: ${s.lastCompletedTask}`
              : "Idle — nothing recorded yet";
      return `${s.name}: ${state}`;
    });

    const headline = active.length
      ? `${active.length} of ${summaries.length} employees are working right now.`
      : `Everyone is idle. Nothing is running.`;

    return { speech: `${headline}\n${lines.join("\n")}`, data: { summaries } };
  },
};

const getAgentDetail: ManagerTool = {
  name: "get_agent_detail",
  description:
    "Describe one employee: their responsibilities, what they are allowed and not allowed to do, their current status, and the instructions currently in force for them. Use when the owner asks about a specific employee.",
  risk: "low",
  parameters: {
    type: "object",
    properties: { agent: { type: "string", description: "Employee name or id, e.g. 'Scout'." } },
    required: ["agent"],
  },
  describe: (p) => `Look up the ${agentName(str(p.agent))}.`,
  async run(params, ctx) {
    const agentId = resolveAgentId(params.agent) ?? ctx.focusAgentId;
    if (!agentId) {
      return { speech: `I couldn't tell which employee you meant. The team is: ${getAgentConfigs().map((a) => a.name).join(", ")}.` };
    }
    const summary = await summarizeAgent(agentId, ctx.repos.agentActivity, ctx.repos.humanReview);
    if (!summary) return { speech: `There's no employee called ${str(params.agent)}.` };

    const instructions = await ctx.repos.instructions.list({ agentId, status: "active" });
    const lines = [
      `${summary.name} — ${summary.role}.`,
      summary.description,
      summary.status === "disabled"
        ? "Currently disabled."
        : summary.status === "working"
          ? `Currently working: ${summary.currentTask}`
          : `Currently idle. ${summary.lastCompletedTask ? `Last did: ${summary.lastCompletedTask}` : "Nothing recorded yet."}`,
      `${summary.jobsProcessed} jobs processed, ${summary.errorCount} errors, ${summary.humanReviewCount} items awaiting review.`,
    ];
    if (instructions.length) {
      lines.push(`${instructions.length} instruction${instructions.length === 1 ? "" : "s"} in force:`);
      for (const i of instructions) lines.push(`• ${i.instruction} (${i.scope}${i.effect ? ", enforced" : ", advisory"})`);
    } else {
      lines.push("No standing instructions.");
    }
    return { speech: lines.join("\n"), data: { summary, instructions } };
  },
};

const getBriefing: ManagerTool = {
  name: "get_briefing",
  description:
    "Produce the owner's briefing: what happened in the last day, the strongest current opportunity, what needs attention, and what the team is doing. Use for 'give me my briefing', 'give me an update', 'catch me up'.",
  risk: "low",
  parameters: {
    type: "object",
    properties: { period: { type: "string", description: "Optional timeframe, e.g. 'yesterday', 'this week'." } },
  },
  describe: () => "Put together your briefing from current platform data.",
  async run(params, ctx) {
    const period = periodFrom(params, ctx, yesterday);
    // A briefing is archived like any other report, so "show me this morning's
    // briefing" works later. Where the database is read-only (the public demo)
    // the figures are still computed and reported — only the archiving is
    // skipped, because a briefing that refuses to speak because it couldn't
    // file itself would be absurd.
    const metrics = await computeMetrics(ctx.repos, period);
    const summary = writeSummary(metrics, period, "briefing");
    let report: Report | null = null;
    try {
      report = await generateReport(ctx.repos, { type: "briefing", period, now: ctx.now() });
    } catch {
      report = null;
    }
    const summaries = await summarizeAllAgents(ctx.repos.agentActivity, ctx.repos.humanReview);
    // The Manager is always "working" while answering — it just logged the
    // request. Counting itself as busy staff would be noise in a briefing.
    const working = summaries.filter((s) => s.status === "working" && s.id !== "manager");

    const hour = ctx.now().getHours();
    const greeting = hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";

    const lines = [greeting, report?.summary ?? summary];
    lines.push(
      working.length
        ? `${working.length} employee${working.length === 1 ? " is" : "s are"} working right now: ${working.map((w) => w.name).join(", ")}.`
        : "No employees are working right now."
    );
    return { speech: lines.join("\n"), data: { report, metrics } };
  },
};

const getActivity: ManagerTool = {
  name: "get_activity",
  description:
    "List what happened over a period — which employees did what, and when. Use for 'what happened yesterday', 'what did the team accomplish last Tuesday'.",
  risk: "low",
  parameters: {
    type: "object",
    properties: {
      period: { type: "string", description: "Timeframe, e.g. 'yesterday', 'last Tuesday', 'this week'." },
      agent: { type: "string", description: "Optional: restrict to one employee." },
    },
  },
  describe: (p) => `Look up activity for ${str(p.period, "the recent period")}.`,
  async run(params, ctx) {
    const period = periodFrom(params, ctx, yesterday);
    const agentId = resolveAgentId(params.agent) ?? undefined;
    const all = await ctx.repos.agentActivity.list({ agentId, limit: 5000 });
    const inPeriod = all.filter((a) => withinPeriod(a.createdAt, period));

    if (inPeriod.length === 0) {
      return { speech: `Nothing was recorded ${period.label}${agentId ? ` for the ${agentName(agentId)}` : ""}.`, data: { activity: [] } };
    }

    const byAgent = new Map<string, number>();
    for (const a of inPeriod) byAgent.set(a.agentId, (byAgent.get(a.agentId) ?? 0) + 1);
    const breakdown = [...byAgent.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => `${agentName(id)} ${count}`)
      .join(", ");

    const notable = inPeriod.slice(0, 8).map((a) => `• ${agentName(a.agentId)}: ${a.summary}`);
    return {
      speech: `${inPeriod.length} recorded actions ${period.label} (${breakdown}).\n${notable.join("\n")}`,
      data: { activity: inPeriod, period },
    };
  },
};

const listLeads: ManagerTool = {
  name: "list_leads",
  description:
    "List the best leads, optionally from a period or city. Use for 'show me the best leads we found yesterday', 'what are my strongest opportunities'.",
  risk: "low",
  parameters: {
    type: "object",
    properties: {
      period: { type: "string", description: "Optional timeframe." },
      city: { type: "string" },
      industry: { type: "string" },
      minScore: { type: "number" },
      limit: { type: "number" },
    },
  },
  describe: () => "Pull the top leads from the database.",
  async run(params, ctx) {
    const limit = Math.min(25, Math.max(1, num(params.limit, 5)));
    // Ranked and bounded in SQL. The tool shows at most 25; pulling the whole
    // table to sort it in memory was fine on mock data and is not on real data.
    const all = await ctx.repos.leads.list({
      city: str(params.city) || undefined,
      industry: str(params.industry) || undefined,
      minScore: params.minScore === undefined ? undefined : num(params.minScore, 0),
      orderBy: "score",
      limit: 500,
    });

    const explicitPeriod = str(params.period) ? parsePeriod(str(params.period), ctx.now()) : null;
    const scoped = explicitPeriod ? all.filter((l) => withinPeriod(l.dateDiscovered, explicitPeriod)) : all;

    const ranked = scoped
      .filter((l) => l.qualificationStatus !== "DISQUALIFIED")
      .sort((a, b) => (b.prospectScore ?? 0) - (a.prospectScore ?? 0))
      .slice(0, limit);

    if (ranked.length === 0) {
      const where = explicitPeriod ? ` from ${explicitPeriod.label}` : "";
      return { speech: `No qualifying leads${where}.`, data: { leads: [] } };
    }

    const where = explicitPeriod ? ` from ${explicitPeriod.label}` : "";
    return {
      speech: `Top ${ranked.length} lead${ranked.length === 1 ? "" : "s"}${where}:\n${ranked.map((l) => `• ${formatLeadLine(l)}`).join("\n")}`,
      data: { leads: ranked },
    };
  },
};

const explainLead: ManagerTool = {
  name: "explain_lead",
  description:
    "Explain why a specific business got the score it did, factor by factor, including whether it was rejected and why. Use for 'why did the Qualifier reject this business'.",
  risk: "low",
  parameters: {
    type: "object",
    properties: {
      business: { type: "string", description: "Business name or lead id." },
    },
    required: ["business"],
  },
  describe: (p) => `Explain the score for ${str(p.business)}.`,
  async run(params, ctx) {
    const raw = str(params.business).trim();
    const query = raw.toLowerCase();
    if (!query) return { speech: "Which business did you mean?" };

    // Ask the database for candidates by name rather than scanning every lead.
    // The sentence case below still needs a pool to match against, so a bounded
    // top-scoring set backs it up.
    const byName = await ctx.repos.leads.list({ nameContains: query, orderBy: "score", limit: 200 });
    const all = byName.length ? byName : await ctx.repos.leads.list({ orderBy: "score", limit: 500 });
    const lead =
      all.find((l) => l.id === raw) ??
      all.find((l) => l.businessName.toLowerCase() === query) ??
      all.find((l) => l.businessName.toLowerCase().includes(query)) ??
      // The question usually arrives as a whole sentence ("why did the Qualifier
      // reject Ocean Nail Bar?"), so also look for any known business name
      // *inside* the text. Longest name first, so "Ocean Nail Bar" wins over a
      // shorter name that happens to be a substring of it.
      [...all]
        .sort((a, b) => b.businessName.length - a.businessName.length)
        .find((l) => query.includes(l.businessName.toLowerCase()));

    if (!lead) {
      return { speech: `I couldn't find a business matching that. Ask me to list leads if you're not sure of the name.` };
    }

    const lines = [
      `${lead.businessName} in ${lead.city} scored ${lead.prospectScore ?? "—"} and is ${lead.qualificationStatus.replace(/_/g, " ").toLowerCase()}.`,
    ];
    if (lead.isDuplicateOf) {
      lines.push(`It was disqualified as a duplicate. ${lead.notes}`);
    }
    if (lead.scoreBreakdown.length) {
      lines.push("Score came from:");
      for (const f of lead.scoreBreakdown) {
        lines.push(`• ${f.points >= 0 ? "+" : ""}${f.points} ${f.label} — ${f.reason}`);
      }
    } else {
      lines.push("No scoring factors applied, so it sits at the base score.");
    }
    lines.push(`Data confidence: ${lead.dataConfidence.toLowerCase()}.`);
    return { speech: lines.join("\n"), data: { lead } };
  },
};

const listInstructions: ManagerTool = {
  name: "list_instructions",
  description:
    "List the instructions the owner has given an employee, or all employees, including revoked and superseded history. Use for 'what permanent instructions have I given the Scout', 'what did I tell the Scout last week', 'what changes did I make this month'.",
  risk: "low",
  parameters: {
    type: "object",
    properties: {
      agent: { type: "string" },
      scope: { type: "string", enum: ["permanent", "temporary"] },
      includeInactive: { type: "boolean", description: "Include revoked/superseded/expired instructions." },
      period: { type: "string" },
    },
  },
  describe: (p) => `Look up instructions${p.agent ? ` for the ${agentName(str(p.agent))}` : ""}.`,
  async run(params, ctx) {
    const agentId = resolveAgentId(params.agent) ?? ctx.focusAgentId ?? undefined;
    const includeInactive = params.includeInactive === true;
    const scope = str(params.scope) as AgentInstruction["scope"] | "";

    let instructions = await ctx.repos.instructions.list({
      agentId,
      scope: scope || undefined,
      status: includeInactive ? undefined : "active",
      limit: 200,
    });

    const explicitPeriod = str(params.period) ? parsePeriod(str(params.period), ctx.now()) : null;
    if (explicitPeriod) instructions = instructions.filter((i) => withinPeriod(i.createdAt, explicitPeriod));

    const who = agentId ? `the ${agentName(agentId)}` : "your team";
    if (instructions.length === 0) {
      return { speech: `No ${scope ? `${scope} ` : ""}instructions on record for ${who}${explicitPeriod ? ` in ${explicitPeriod.label}` : ""}.`, data: { instructions: [] } };
    }

    const lines = instructions.map((i) => {
      const when = new Date(i.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      const state = i.status === "active" ? "" : ` [${i.status}]`;
      const kind = i.effect ? "enforced" : "advisory";
      return `• ${i.instruction} — ${i.scope}, ${kind}, given ${when}${state}${agentId ? "" : ` (${agentName(i.agentId)})`}`;
    });
    return {
      speech: `${instructions.length} instruction${instructions.length === 1 ? "" : "s"} for ${who}:\n${lines.join("\n")}`,
      data: { instructions },
    };
  },
};

const listReports: ManagerTool = {
  name: "list_reports",
  description:
    "List archived reports, optionally by type or period. Use for 'show me the Friday report from three weeks ago', 'what reports do I have'.",
  risk: "low",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["daily", "weekly", "briefing", "custom"] },
      period: { type: "string" },
      limit: { type: "number" },
    },
  },
  describe: () => "Look in the report archive.",
  async run(params, ctx) {
    const explicitPeriod = str(params.period) ? parsePeriod(str(params.period), ctx.now()) : null;
    const reports = await ctx.repos.reports.list({
      type: (str(params.type) as ReportType) || undefined,
      since: explicitPeriod?.start,
      until: explicitPeriod?.end,
      limit: Math.min(50, Math.max(1, num(params.limit, 10))),
    });

    if (reports.length === 0) {
      return { speech: `Nothing in the archive${explicitPeriod ? ` for ${explicitPeriod.label}` : ""} yet.`, data: { reports: [] } };
    }
    // A single hit is almost always "show me that report" rather than "list", so
    // return its contents instead of a one-item list.
    if (reports.length === 1) {
      return { speech: `${reports[0].title}:\n${reports[0].summary}`, data: { reports } };
    }
    const lines = reports.map(
      (r) => `• ${r.title} — generated ${new Date(r.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    );
    return { speech: `${reports.length} reports in the archive:\n${lines.join("\n")}`, data: { reports } };
  },
};

const comparePeriods: ManagerTool = {
  name: "compare_periods",
  description:
    "Compare one period against the one before it. Use for 'compare this week with last week', 'how are we doing vs last week'.",
  risk: "low",
  parameters: { type: "object", properties: { period: { type: "string" } } },
  describe: () => "Compare the two periods.",
  async run(params, ctx) {
    const period = periodFrom(params, ctx, (now) => rollingWeek(now, 0));
    const report = await generateReport(ctx.repos, { type: "custom", period, now: ctx.now() });
    const m = report.metrics;
    const prev = m.previousPeriod;
    if (!prev) return { speech: report.summary, data: { report } };

    const lines = [
      `Comparing ${period.label} with the period before it:`,
      `• Discovered: ${m.businessesDiscovered} vs ${prev.businessesDiscovered}`,
      `• Qualified: ${m.qualifiedLeads} vs ${prev.qualifiedLeads}`,
      `• High priority: ${m.highPriorityLeads} vs ${prev.highPriorityLeads}`,
      `• Average score: ${m.averageScore ?? "—"} vs ${prev.averageScore ?? "—"}`,
    ];
    return { speech: lines.join("\n"), data: { report } };
  },
};

const listScheduledTasks: ManagerTool = {
  name: "list_scheduled_tasks",
  description: "List the recurring reports the owner has set up. Use for 'what have I got scheduled'.",
  risk: "low",
  parameters: { type: "object", properties: {} },
  describe: () => "List your scheduled tasks.",
  async run(_params, ctx) {
    const tasks = await ctx.repos.scheduledTasks.list({});
    if (tasks.length === 0) return { speech: "Nothing is scheduled.", data: { tasks: [] } };
    const lines = tasks.map((t) => {
      const time = `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
      const when = t.dayOfWeek === null ? `daily at ${time}` : `every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][t.dayOfWeek]} at ${time}`;
      return `• ${t.name} — ${when}${t.active ? "" : " (paused)"}${t.lastRunAt ? `, last ran ${new Date(t.lastRunAt).toLocaleDateString("en-GB")}` : ", never run"}`;
    });
    return { speech: `${tasks.length} scheduled:\n${lines.join("\n")}`, data: { tasks } };
  },
};

// ---------------------------------------------------------------------------
// Consequential tools (risk: medium/high — confirm first)
// ---------------------------------------------------------------------------

const giveInstruction: ManagerTool = {
  name: "give_instruction",
  description:
    "Record an instruction for an employee, either permanent (a standing rule) or temporary (this campaign / today only). Use for 'tell the Scout I don't want chains anymore', 'from now on prioritize independent businesses', 'for today's search only look at Miami Beach'.",
  risk: "medium",
  parameters: {
    type: "object",
    properties: {
      agent: { type: "string", description: "Which employee." },
      instruction: { type: "string", description: "The instruction, in the owner's own words." },
      scope: { type: "string", enum: ["permanent", "temporary"], description: "permanent = standing rule; temporary = expires." },
      rationale: { type: "string", description: "Why, if the owner said." },
      campaignId: { type: "string", description: "Optional: bind a temporary instruction to one campaign." },
    },
    required: ["agent", "instruction", "scope"],
  },
  describe(params, ctx) {
    const scope = str(params.scope) === "permanent" ? "a permanent standing rule" : "a temporary instruction";
    const text = str(params.instruction).trim();
    // The `agent` param often arrives as the owner's whole sentence, so resolve
    // it the same way run() will rather than printing it raw. Falls back to the
    // effect-based inference so the confirmation names the employee that will
    // actually receive it — approving "give the <entire sentence> a rule" tells
    // the owner nothing about what they are agreeing to.
    const resolved =
      resolveAgentId(params.agent) ??
      ctx.focusAgentId ??
      agentForEffect(parseInstructionEffect(text, { knownCities: getTerritories().map((t) => t.city) }));
    const who = resolved ? `the ${agentName(resolved)}` : "an employee";
    return `Give ${who} ${scope}: "${text}"`;
  },
  async run(params, ctx) {
    const text = str(params.instruction).trim();
    if (!text) return { speech: "What would you like me to tell them?" };

    const scope = str(params.scope) === "temporary" ? "temporary" : "permanent";
    const now = ctx.now();
    const effect = parseInstructionEffect(text, { knownCities: getTerritories().map((t) => t.city) });

    // "For today's search, only look at Delray Beach" names no employee, but
    // the instruction itself says who it is for: only the Scout discovers, only
    // the Qualifier scores. Inferring from the effect is safe precisely because
    // the effect is what will actually be enforced — the instruction cannot end
    // up on an employee that would never act on it.
    const agentId = resolveAgentId(params.agent) ?? ctx.focusAgentId ?? agentForEffect(effect);
    if (!agentId) {
      return {
        speech: `Which employee is that for? The team is: ${getAgentConfigs().filter((a) => !a.disabled).map((a) => a.name).join(", ")}.`,
      };
    }

    // A permanent instruction that contradicts an existing one supersedes it
    // rather than stacking, so two opposite rules can never both be in force.
    const existing = await ctx.repos.instructions.list({ agentId, scope: "permanent", status: "active" });
    const conflicting =
      scope === "permanent" && effect
        ? existing.filter((i) => i.effect?.kind === effect.kind)
        : [];

    const instruction: AgentInstruction = {
      id: randomUUID(),
      agentId,
      instruction: text,
      scope,
      status: "active",
      effect,
      effectKind: effect?.kind ?? null,
      rationale: str(params.rationale) || null,
      source: "manager_conversation",
      conversationId: ctx.conversationId,
      messageId: ctx.messageId,
      createdBy: "owner",
      version: conflicting.length ? Math.max(...conflicting.map((c) => c.version)) + 1 : 1,
      supersedesId: conflicting[0]?.id ?? null,
      supersededById: null,
      campaignId: scope === "temporary" ? str(params.campaignId) || null : null,
      // A temporary instruction with no campaign binding expires at end of day —
      // "for today's search" has to actually stop applying tomorrow.
      expiresAt:
        scope === "temporary" && !str(params.campaignId)
          ? new Date(new Date(now).setHours(23, 59, 59, 999)).toISOString()
          : null,
      createdAt: now.toISOString(),
      revokedAt: null,
      revokedReason: null,
    };

    await ctx.repos.instructions.create(instruction);
    for (const old of conflicting) {
      await ctx.repos.instructions.update({
        ...old,
        status: "superseded",
        supersededById: instruction.id,
      });
    }

    const lines = [`Noted. I've told the ${agentName(agentId)}: "${text}"`, describeEffect(effect)];
    if (conflicting.length) {
      lines.push(`This replaces an earlier rule: "${conflicting[0].instruction}"`);
    }
    if (scope === "temporary") {
      lines.push(
        instruction.campaignId
          ? "It applies to that campaign only."
          : "It applies for today only and expires tonight."
      );
    }
    return { speech: lines.join(" "), data: { instruction } };
  },
};

const revokeInstruction: ManagerTool = {
  name: "revoke_instruction",
  description:
    "Cancel a standing instruction so it stops applying. Use for 'undo the permanent instruction I gave the Scout last Friday', 'forget what I said about chains'.",
  risk: "medium",
  parameters: {
    type: "object",
    properties: {
      agent: { type: "string" },
      match: { type: "string", description: "Words from the instruction to cancel." },
      instructionId: { type: "string" },
      reason: { type: "string" },
    },
  },
  describe: (p) => `Cancel a standing instruction for the ${agentName(str(p.agent))}.`,
  async run(params, ctx) {
    const agentId = resolveAgentId(params.agent) ?? ctx.focusAgentId ?? undefined;
    const candidates = await ctx.repos.instructions.list({ agentId, status: "active", limit: 200 });
    if (candidates.length === 0) {
      return { speech: `There are no active instructions${agentId ? ` for the ${agentName(agentId)}` : ""} to cancel.` };
    }

    const byId = str(params.instructionId) ? candidates.find((c) => c.id === str(params.instructionId)) : null;
    const match = str(params.match).toLowerCase();
    const byMatch = match
      ? candidates.find((c) => c.instruction.toLowerCase().includes(match)) ??
        candidates.find((c) => match.split(/\s+/).some((w) => w.length > 3 && c.instruction.toLowerCase().includes(w)))
      : null;

    // With no way to identify which one, list them rather than guessing — the
    // wrong instruction silently cancelled is worse than an extra question.
    const target = byId ?? byMatch ?? (candidates.length === 1 ? candidates[0] : null);
    if (!target) {
      return {
        speech: `Which one? ${candidates.map((c, i) => `${i + 1}. "${c.instruction}"`).join(" ")}`,
        data: { candidates },
      };
    }

    await ctx.repos.instructions.update({
      ...target,
      status: "revoked",
      revokedAt: ctx.now().toISOString(),
      revokedReason: str(params.reason) || "Cancelled by owner",
    });
    return {
      speech: `Cancelled. The ${agentName(target.agentId)} is no longer following: "${target.instruction}"`,
      data: { instruction: target },
    };
  },
};

const startWork: ManagerTool = {
  name: "start_work",
  description:
    "Create a prospecting campaign from a natural-language request and queue the work. Use for 'find 50 dog groomers in Miami with no online booking', 'have the Scout look for barbers in Delray'.",
  risk: "medium",
  parameters: {
    type: "object",
    properties: { request: { type: "string", description: "The full request in the owner's words." } },
    required: ["request"],
  },
  describe: (p) => `Create a campaign for: "${str(p.request)}"`,
  async run(params, ctx) {
    const text = str(params.request).trim();
    if (!text) return { speech: "What would you like the team to look for?" };

    const result = await ctx.manager.assignTask(text, ctx.commandParser);
    if (!result.campaign) {
      return { speech: result.parsed.clarification ?? "I couldn't work out the city and trade from that.", data: { parsed: result.parsed } };
    }
    return {
      speech: `Done. I've set up "${result.campaign.name}" targeting ${result.campaign.targetLeadCount} businesses, split into ${result.jobs.length} job${result.jobs.length === 1 ? "" : "s"}. It's in draft — say "start it" when you're ready.`,
      data: { campaign: result.campaign, jobs: result.jobs },
    };
  },
};

const controlCampaign: ManagerTool = {
  name: "control_campaign",
  description:
    "Start, pause, resume or stop a campaign, or run its next job. Use for 'start that campaign', 'pause the Miami search', 'run the next job'.",
  risk: "medium",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["start", "pause", "resume", "stop", "run_next_job"] },
      campaign: { type: "string", description: "Campaign name or id. Defaults to the most recent." },
    },
    required: ["action"],
  },
  describe: (p) => `${str(p.action).replace(/_/g, " ")} the campaign${p.campaign ? ` "${str(p.campaign)}"` : ""}.`,
  async run(params, ctx) {
    const action = str(params.action);
    const campaigns = await ctx.repos.campaigns.list();
    if (campaigns.length === 0) return { speech: "There are no campaigns yet." };

    const query = str(params.campaign).toLowerCase();
    const campaign =
      (query ? campaigns.find((c) => c.id === str(params.campaign)) ?? campaigns.find((c) => c.name.toLowerCase().includes(query)) : null) ??
      [...campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

    switch (action) {
      case "start":
        await ctx.manager.startCampaign(campaign.id);
        return { speech: `"${campaign.name}" is running.`, data: { campaignId: campaign.id } };
      case "pause":
        await ctx.manager.pauseCampaign(campaign.id);
        return { speech: `Paused "${campaign.name}".`, data: { campaignId: campaign.id } };
      case "resume":
        await ctx.manager.resumeCampaign(campaign.id);
        return { speech: `Resumed "${campaign.name}".`, data: { campaignId: campaign.id } };
      case "stop":
        await ctx.manager.stopCampaign(campaign.id);
        return { speech: `Stopped "${campaign.name}".`, data: { campaignId: campaign.id } };
      case "run_next_job": {
        const pending = (await ctx.repos.jobs.list({ campaignId: campaign.id, status: "pending" }))[0];
        if (!pending) return { speech: `"${campaign.name}" has no jobs waiting.` };
        const run = await ctx.manager.runJob(pending);
        return {
          speech: `Job finished: ${run.outcome.replace(/_/g, " ")}, ${run.leadsCreated} lead${run.leadsCreated === 1 ? "" : "s"} added.`,
          data: { result: run },
        };
      }
      default:
        return { speech: `I don't know how to "${action}" a campaign.` };
    }
  },
};

const generateReportTool: ManagerTool = {
  name: "generate_report",
  description:
    "Generate and archive a report for a period. Use for 'generate my daily report', 'write up last week'.",
  risk: "low",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["daily", "weekly", "custom"] },
      period: { type: "string" },
    },
  },
  describe: (p) => `Generate a ${str(p.type, "daily")} report.`,
  async run(params, ctx) {
    const type = (str(params.type) || "daily") as ReportType;
    const period = periodFrom(params, ctx, type === "weekly" ? (now) => rollingWeek(now, 0) : yesterday);
    const report = await generateReport(ctx.repos, { type, period, now: ctx.now() });
    return { speech: `${report.title}:\n${report.summary}`, data: { report } };
  },
};

const scheduleReport: ManagerTool = {
  name: "schedule_report",
  description:
    "Set up a recurring report. Use for 'every morning at 9 give me a progress report', 'every Friday give me a weekly report'.",
  risk: "medium",
  parameters: {
    type: "object",
    properties: {
      request: { type: "string", description: "The owner's full scheduling sentence." },
    },
    required: ["request"],
  },
  describe: (p) => `Set up a recurring report: "${str(p.request)}"`,
  async run(params, ctx) {
    const text = str(params.request).trim();
    const parsed = parseSchedule(text);
    if (!parsed) {
      return { speech: "I couldn't work out the timing. Try something like \"every morning at 9\" or \"every Friday at 5pm\"." };
    }
    const now = ctx.now();
    const time = `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;
    const dayName = parsed.dayOfWeek === null ? null : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][parsed.dayOfWeek];

    const task: ScheduledTask = {
      id: randomUUID(),
      name: parsed.kind === "weekly_report" ? `Weekly report — ${dayName} ${time}` : `Daily report — ${time}`,
      kind: parsed.kind,
      instruction: text,
      hour: parsed.hour,
      minute: parsed.minute,
      dayOfWeek: parsed.dayOfWeek,
      timezone: "UTC",
      active: true,
      lastRunAt: null,
      lastRunStatus: null,
      nextRunAt: nextRunAt({ hour: parsed.hour, minute: parsed.minute, dayOfWeek: parsed.dayOfWeek }, now),
      conversationId: ctx.conversationId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await ctx.repos.scheduledTasks.create(task);

    return {
      speech:
        `Scheduled: ${task.name}. It's stored, so it survives restarts rather than depending on me remembering. ` +
        `Times are UTC for now — the scheduler doesn't do timezones yet.`,
      data: { task },
    };
  },
};

const cancelScheduledTask: ManagerTool = {
  name: "cancel_scheduled_task",
  description: "Cancel a recurring report. Use for 'stop the daily report'.",
  risk: "medium",
  parameters: { type: "object", properties: { match: { type: "string" } } },
  describe: () => "Cancel a scheduled report.",
  async run(params, ctx) {
    const tasks = await ctx.repos.scheduledTasks.list({ active: true });
    if (tasks.length === 0) return { speech: "Nothing is scheduled." };
    const match = str(params.match).toLowerCase();
    const target =
      (match ? tasks.find((t) => t.name.toLowerCase().includes(match) || t.kind.includes(match)) : null) ??
      (tasks.length === 1 ? tasks[0] : null);
    if (!target) {
      return { speech: `Which one? ${tasks.map((t) => t.name).join(", ")}.`, data: { tasks } };
    }
    await ctx.repos.scheduledTasks.update({ ...target, active: false, updatedAt: ctx.now().toISOString() });
    return { speech: `Cancelled "${target.name}".`, data: { task: target } };
  },
};

const talkToAgent: ManagerTool = {
  name: "talk_to_agent",
  description:
    "Focus the conversation on one employee, so follow-up messages are addressed to them. Use for 'let me talk to the Scout', 'put me through to the Qualifier'.",
  risk: "low",
  parameters: {
    type: "object",
    properties: { agent: { type: "string" } },
    required: ["agent"],
  },
  describe: (p) => `Hand the conversation to the ${agentName(str(p.agent))}.`,
  async run(params, ctx) {
    const agentId = resolveAgentId(params.agent);
    if (!agentId) {
      return { speech: `I don't have an employee called "${str(params.agent)}". The team is: ${getAgentConfigs().map((a) => a.name).join(", ")}.` };
    }
    const summary = await summarizeAgent(agentId, ctx.repos.agentActivity, ctx.repos.humanReview);
    const instructions = await ctx.repos.instructions.list({ agentId, status: "active" });
    const state =
      summary?.status === "working" ? `currently ${summary.currentTask}` : "not working on anything right now";
    return {
      speech: `Putting you through to the ${agentName(agentId)} — ${state}. ${instructions.length ? `${instructions.length} instruction${instructions.length === 1 ? "" : "s"} in force.` : "No standing instructions."} Go ahead.`,
      data: { focusAgentId: agentId, summary, instructions },
    };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const MANAGER_TOOLS: ManagerTool[] = [
  getTeamStatus,
  getAgentDetail,
  getBriefing,
  getActivity,
  listLeads,
  explainLead,
  listInstructions,
  listReports,
  comparePeriods,
  listScheduledTasks,
  giveInstruction,
  revokeInstruction,
  startWork,
  controlCampaign,
  generateReportTool,
  scheduleReport,
  cancelScheduledTask,
  talkToAgent,
  // The Communications Centre's tools. They are part of the same list on
  // purpose: the Manager chooses between 'give me a briefing' and 'email John'
  // the same way it chooses anything else, and voice and text both arrive here.
  ...COMMS_TOOLS,
];

export function findTool(name: string): ManagerTool | null {
  return MANAGER_TOOLS.find((t) => t.name === name) ?? null;
}

/** Tools that run without asking. Everything else needs the owner to confirm. */
export function requiresApproval(tool: ManagerTool): boolean {
  return tool.risk !== "low";
}
