import type { DiscoveredLeadSeed, Lead, ScoreFactorResult } from "../types";
import { CHAIN_NAME_PATTERNS, looksLikeChain } from "../mockData/fakeBusinessNames";
import type { AgentInstruction, InstructionEffect, ScoreCondition } from "./types";

/**
 * Turning an instruction into a behaviour change.
 *
 * The central honesty constraint of the whole Manager: an instruction either
 * has a real, enforced effect, or it is ADVISORY and says so. There is no third
 * state where the system implies it changed something and didn't.
 *
 * `parseInstructionEffect` recognizes a deliberately small set of instruction
 * shapes. Everything else is stored, versioned, shown on the employee's page
 * and quoted back on request — but marked advisory, because pretending an
 * arbitrary English sentence reconfigured a pipeline would be a lie.
 *
 * Adding a new enforced instruction shape means: a pattern here, a branch in
 * the matching `apply*` function, and a case in scripts/test-manager.ts.
 */

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** A city mentioned in an instruction has to be a real territory to be enforceable. */
export interface EffectParseContext {
  knownCities: string[];
}

interface EffectRule {
  /** Must match for the rule to fire. */
  test: RegExp;
  /** Must NOT match — used to separate "exclude chains" from "prefer chains". */
  reject?: RegExp;
  build(text: string, ctx: EffectParseContext): InstructionEffect | null;
}

const SCORE_CONDITION_PATTERNS: { pattern: RegExp; condition: ScoreCondition; label: string }[] = [
  { pattern: /no\s+online\s+booking|without\s+online\s+booking|don'?t\s+book\s+online/i, condition: "no_online_booking", label: "No online booking" },
  { pattern: /no\s+website|without\s+a?\s*website/i, condition: "no_website", label: "No website" },
  { pattern: /poor\s+(or\s+outdated\s+)?website|bad\s+website|outdated\s+website/i, condition: "poor_website", label: "Poor website" },
  { pattern: /phone[\s-]?only/i, condition: "phone_only_booking", label: "Phone-only booking" },
  { pattern: /broken\s+(booking\s+)?link|booking\s+link.*broken|dead\s+link/i, condition: "broken_booking_link", label: "Broken booking link" },
  { pattern: /independent|non[\s-]?chain|not\s+a?\s*chain|local(ly)?[\s-]owned/i, condition: "independent_business", label: "Independent business" },
];

/** Words that mean "add points" vs "take points away". */
const RAISE = /(higher|raise|increase|boost|prioriti[sz]e|favou?r|prefer|more\s+important|up\s+weight|upweight)/i;
const LOWER = /(lower|reduce|decrease|deprioriti[sz]e|less\s+important|down\s+weight|downweight|penali[sz]e)/i;

const DEFAULT_SCORE_ADJUST_POINTS = 10;

const RULES: EffectRule[] = [
  // "don't include national chains" / "no more chains" / "exclude franchises"
  {
    test: /(chain|franchise)/i,
    reject: /(only|just)\s+(national\s+)?(chain|franchise)/i,
    build(text) {
      const excluding = /(no|not|don'?t|exclude|stop|avoid|without|drop|skip|remove|ignore)/i.test(text);
      if (!excluding) return null;
      return { kind: "exclude_name_patterns", patterns: [...CHAIN_NAME_PATTERNS] };
    },
  },

  // "only search Miami Beach" / "restrict to Delray Beach"
  {
    test: /(only|just|restrict|limit|stick)\b/i,
    build(text, ctx) {
      const lower = text.toLowerCase();
      const cities = ctx.knownCities.filter((city) => lower.includes(city.toLowerCase()));
      if (cities.length === 0) return null;
      return { kind: "restrict_cities", cities };
    },
  },

  // "score businesses with no online booking higher"
  {
    test: /(score|scoring|points|priorit|weight|rank|opportunity)/i,
    build(text) {
      const match = SCORE_CONDITION_PATTERNS.find((c) => c.pattern.test(text));
      if (!match) return null;
      if (!RAISE.test(text) && !LOWER.test(text)) return null;

      // An explicit number wins over the default, so "give them 20 more points"
      // means 20 rather than a silent house value.
      const explicit = text.match(/\b(\d{1,2})\s*(points?|pts?)\b/i);
      const magnitude = explicit ? Number(explicit[1]) : DEFAULT_SCORE_ADJUST_POINTS;
      const signed = LOWER.test(text) && !RAISE.test(text) ? -magnitude : magnitude;

      return {
        kind: "score_adjust",
        condition: match.condition,
        points: signed,
        label: `${match.label} (owner instruction)`,
      };
    },
  },

  // "only show me leads scoring 70 or above"
  {
    test: /(minimum|at\s+least|above|over|threshold|only.*(scor|rat)ing)/i,
    build(text) {
      const match = text.match(/\b(\d{1,3})\b/);
      if (!match) return null;
      const minScore = Number(match[1]);
      if (minScore < 1 || minScore > 100) return null;
      if (!/(scor|point|rat)/i.test(text)) return null;
      return { kind: "min_score_threshold", minScore };
    },
  },
];

/**
 * Best-effort structured effect for an instruction, or null for advisory.
 *
 * Rules are tried in order and the first that produces an effect wins, so more
 * specific shapes (chains, cities) are listed before the general scoring one.
 */
export function parseInstructionEffect(text: string, ctx: EffectParseContext): InstructionEffect | null {
  for (const rule of RULES) {
    if (!rule.test.test(text)) continue;
    if (rule.reject?.test(text)) continue;
    const effect = rule.build(text, ctx);
    if (effect) return effect;
  }
  return null;
}

/** One-line, non-technical description of what an effect actually does. */
export function describeEffect(effect: InstructionEffect | null): string {
  if (!effect) {
    return "Advisory — recorded and shown to the employee, but not automatically enforced.";
  }
  switch (effect.kind) {
    case "exclude_name_patterns":
      return `Enforced — the Scout drops candidates whose name contains: ${effect.patterns.join(", ")}.`;
    case "restrict_cities":
      return `Enforced — discovery is limited to ${effect.cities.join(", ")}.`;
    case "score_adjust": {
      const dir = effect.points >= 0 ? "adds" : "subtracts";
      return `Enforced — the Qualifier ${dir} ${Math.abs(effect.points)} points when: ${effect.label.replace(" (owner instruction)", "")}.`;
    }
    case "min_score_threshold":
      return `Enforced — leads scoring under ${effect.minScore} are treated as unqualified.`;
  }
}

// ---------------------------------------------------------------------------
// Selecting which instructions are in force right now
// ---------------------------------------------------------------------------

/**
 * The instructions that apply to this agent, at this moment, for this campaign.
 *
 * Temporary instructions drop out once they expire or once work moves to a
 * different campaign — that is the whole point of the temporary/permanent
 * split, and it is enforced here rather than trusted to the caller.
 */
export function activeInstructionsFor(
  instructions: AgentInstruction[],
  opts: { campaignId?: string | null; now?: Date } = {}
): AgentInstruction[] {
  const now = opts.now ?? new Date();
  return instructions.filter((instruction) => {
    if (instruction.status !== "active") return false;
    if (instruction.expiresAt && new Date(instruction.expiresAt).getTime() <= now.getTime()) return false;
    // A temporary instruction bound to a campaign never leaks into another one.
    if (instruction.campaignId && instruction.campaignId !== opts.campaignId) return false;
    return true;
  });
}

/** The enforceable effects among a set of instructions, in creation order. */
export function effectsOf(instructions: AgentInstruction[]): InstructionEffect[] {
  return instructions
    .map((i) => i.effect)
    .filter((e): e is InstructionEffect => e !== null && e !== undefined);
}

// ---------------------------------------------------------------------------
// Applying — discovery
// ---------------------------------------------------------------------------

export interface DiscoveryFilterResult {
  kept: DiscoveredLeadSeed[];
  /** What was dropped and why, so the Manager can report it rather than silently shrinking a batch. */
  dropped: { businessName: string; reason: string }[];
}

/**
 * Applies the Scout's in-force instructions to a freshly discovered batch.
 *
 * Returns what was dropped as well as what was kept: a batch that silently
 * comes back short is exactly the situation that produces "why did the Scout
 * only find 54 businesses?", and the answer should be recorded at the moment
 * it happens rather than reconstructed later.
 */
export function applyDiscoveryInstructions(
  seeds: DiscoveredLeadSeed[],
  effects: InstructionEffect[]
): DiscoveryFilterResult {
  const kept: DiscoveredLeadSeed[] = [];
  const dropped: { businessName: string; reason: string }[] = [];

  for (const seed of seeds) {
    let dropReason: string | null = null;

    for (const effect of effects) {
      if (effect.kind === "exclude_name_patterns") {
        const lower = seed.businessName.toLowerCase();
        const hit = effect.patterns.find((p) => lower.includes(p.toLowerCase()));
        if (hit) {
          dropReason = `name contains "${hit}" — excluded by instruction`;
          break;
        }
      }
      if (effect.kind === "restrict_cities") {
        const allowed = effect.cities.some((c) => c.toLowerCase() === seed.city.toLowerCase());
        if (!allowed) {
          dropReason = `city ${seed.city} is outside the restricted area (${effect.cities.join(", ")})`;
          break;
        }
      }
    }

    if (dropReason) dropped.push({ businessName: seed.businessName, reason: dropReason });
    else kept.push(seed);
  }

  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// Applying — scoring
// ---------------------------------------------------------------------------

/** Whether a score_adjust condition holds for a lead. Each maps to a real field. */
function conditionHolds(condition: ScoreCondition, lead: Lead): boolean {
  switch (condition) {
    case "no_online_booking":
      return lead.onlineBookingStatus === "NONE";
    case "no_website":
      return lead.websiteStatus === "NONE";
    case "poor_website":
      return lead.websiteStatus === "EXISTS" && lead.websiteQuality === "POOR";
    case "phone_only_booking":
      return lead.bookingMethod === "PHONE_ONLY";
    case "broken_booking_link":
      // A detected booking link that didn't resolve. Distinct from having no
      // booking at all: this business believes it takes bookings online and is
      // silently losing them, which is a sharper pitch than "you have nothing".
      return (lead.detectedLinks ?? []).some((l) => l.purpose === "booking" && l.reachable === false);
    case "independent_business":
      // Two independent signals, either sufficient: a franchise-shaped name, or
      // more than one location on record.
      return !looksLikeChain(lead.businessName) && (lead.locationCount ?? 1) <= 1;
  }
}

export interface ScoreAdjustment {
  factor: ScoreFactorResult;
  points: number;
}

/**
 * Extra score factors contributed by the Qualifier's in-force instructions.
 *
 * Returned as ordinary ScoreFactorResult rows so they appear in the lead's
 * score breakdown exactly like configured factors do — an owner-instructed
 * adjustment should be as visible and auditable as a built-in one, not a
 * hidden nudge to the total.
 */
export function scoreAdjustmentsFor(lead: Lead, effects: InstructionEffect[]): ScoreAdjustment[] {
  const adjustments: ScoreAdjustment[] = [];
  for (const effect of effects) {
    if (effect.kind !== "score_adjust") continue;
    if (!conditionHolds(effect.condition, lead)) continue;
    adjustments.push({
      points: effect.points,
      factor: {
        id: `instruction:${effect.condition}`,
        label: effect.label,
        category: "owner-instruction",
        points: effect.points,
        reason: `Applied because you instructed the Qualifier to weight this.`,
      },
    });
  }
  return adjustments;
}

/** The strictest minimum-score threshold in force, or null when none is set. */
export function minScoreThreshold(effects: InstructionEffect[]): number | null {
  const thresholds = effects
    .filter((e): e is Extract<InstructionEffect, { kind: "min_score_threshold" }> => e.kind === "min_score_threshold")
    .map((e) => e.minScore);
  return thresholds.length ? Math.max(...thresholds) : null;
}
