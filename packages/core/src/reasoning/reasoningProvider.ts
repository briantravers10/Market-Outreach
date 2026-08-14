import type { ScoreFactorResult } from "../types";

/**
 * SEAM for genuine LLM reasoning. This phase never calls a real model —
 * MockReasoningProvider builds narrative text from templates. Later, a
 * ClaudeReasoningProvider can implement the same interface (e.g. to write
 * a sharper score_reason from real research notes, or to actually judge
 * website quality from page content) without changing any worker code.
 */
export interface ReasoningProvider {
  readonly providerName: string;
  summarizeScore(businessName: string, breakdown: ScoreFactorResult[], score: number): Promise<string>;
  explainWebsiteBookingAnalysis(input: {
    businessName: string;
    websiteQuality: string;
    bookingMethod: string;
  }): Promise<string>;
}

export class MockReasoningProvider implements ReasoningProvider {
  readonly providerName = "mock-reasoning-v1";

  async summarizeScore(businessName: string, breakdown: ScoreFactorResult[], score: number): Promise<string> {
    const positives = breakdown.filter((f) => f.points > 0).sort((a, b) => b.points - a.points);
    const negatives = breakdown.filter((f) => f.points < 0).sort((a, b) => a.points - b.points);

    const parts: string[] = [];
    if (positives.length) {
      parts.push(`Opportunity signals: ${positives.slice(0, 3).map((f) => f.label.toLowerCase()).join(", ")}.`);
    }
    if (negatives.length) {
      parts.push(`Offsetting factors: ${negatives.slice(0, 2).map((f) => f.label.toLowerCase()).join(", ")}.`);
    }
    if (!parts.length) {
      parts.push("No strong signals either way — scored at baseline.");
    }
    return `${businessName} scored ${score}/100. ${parts.join(" ")}`;
  }

  async explainWebsiteBookingAnalysis(input: {
    businessName: string;
    websiteQuality: string;
    bookingMethod: string;
  }): Promise<string> {
    return `${input.businessName}: website assessed as ${input.websiteQuality.toLowerCase()}; booking observed as ${input.bookingMethod
      .toLowerCase()
      .replace(/_/g, " ")}.`;
  }
}
