import { getIndustries, getTerritories } from "../config";
import type { ParsedCommand } from "./intentTypes";

/**
 * SEAM for the Manager's natural-language understanding. This phase ships a
 * deterministic implementation — real, working for the command shapes the
 * product asks for, just pattern-matching instead of an LLM call. A real
 * Claude-API-backed implementation slots in later behind this same
 * interface once the user authorizes the API key/billing for it (their own
 * "no paid APIs without asking" rule applies here).
 */
export interface CommandParser {
  readonly parserName: string;
  parse(text: string): ParsedCommand;
}

const FILTER_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /no\s+(online\s+)?booking/i, label: "No online booking preferred" },
  { pattern: /no\s+website/i, label: "No website preferred" },
  { pattern: /poor\s+(or\s+outdated\s+)?website/i, label: "Poor/outdated website preferred" },
  { pattern: /phone[\s-]?only\s+booking/i, label: "Phone-only booking preferred" },
  { pattern: /(social|dm)[\s\/-]*(media\s+)?(dm)?\s*booking/i, label: "Social/DM booking preferred" },
  { pattern: /(strong|good|great)\s+reviews?/i, label: "Strong reviews preferred" },
  { pattern: /multiple\s+(staff|providers|employees|locations)/i, label: "Multiple staff preferred" },
  { pattern: /active\s+social(\s+media)?(\s+presence)?/i, label: "Active social presence preferred" },
  { pattern: /(high[\s-]?priority|80\s*\+|score[sd]?\s+80)/i, label: "High-priority (80+) scores preferred" },
];

const DEFAULT_QUANTITY = 15;

/**
 * Extracts industry/city/quantity/filters from a free-text instruction like
 * "Find 50 dog groomers in Miami with no online booking." Matches against
 * config/industries.json and config/territories.json — the same source of
 * truth the rest of the app uses, so a parsed campaign always lines up with
 * a real, campaign-creatable city+industry pair.
 */
export class DeterministicCommandParser implements CommandParser {
  readonly parserName = "deterministic-v1";

  parse(text: string): ParsedCommand {
    const lower = text.toLowerCase();

    const industry = getIndustries().find((i) => {
      const label = i.label.toLowerCase();
      const singular = label.endsWith("s") ? label.slice(0, -1) : label;
      return lower.includes(label) || lower.includes(singular);
    });

    const territory = getTerritories().find((t) => lower.includes(t.city.toLowerCase()));

    const quantityMatch = lower.match(/\b(\d{1,4})\b/);
    const targetQuantity = quantityMatch ? Math.max(1, Math.min(500, Number(quantityMatch[1]))) : DEFAULT_QUANTITY;

    const filters = FILTER_PATTERNS.filter((f) => f.pattern.test(text)).map((f) => f.label);

    const missing: string[] = [];
    if (!industry) missing.push(`an industry (try: ${getIndustries().map((i) => i.label).join(", ")})`);
    if (!territory) missing.push(`a city (try: ${getTerritories().map((t) => t.city).join(", ")})`);

    const confidence: ParsedCommand["confidence"] = missing.length ? "NEEDS_CLARIFICATION" : "HIGH";
    const clarification = missing.length ? `I couldn't tell ${missing.join(" and ")}. Try rephrasing with one of those.` : null;

    return {
      raw: text,
      industryId: industry?.id ?? null,
      industryLabel: industry?.label ?? null,
      city: territory?.city ?? null,
      targetQuantity,
      filters,
      confidence,
      clarification,
    };
  }
}
