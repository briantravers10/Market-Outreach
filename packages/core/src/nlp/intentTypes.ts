export interface ParsedCommand {
  raw: string;
  industryId: string | null;
  industryLabel: string | null;
  city: string | null;
  targetQuantity: number;
  /** Human-readable filter phrases, e.g. "No online booking preferred". */
  filters: string[];
  confidence: "HIGH" | "NEEDS_CLARIFICATION";
  /** Set when confidence is NEEDS_CLARIFICATION — what to tell the user. */
  clarification: string | null;
}
