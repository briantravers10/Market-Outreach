"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  applyVerification,
  getScoringConfig,
  KNOWN_BOOKING_PROVIDERS,
  MockReasoningProvider,
  qualificationStatusForScore,
  scoreLead,
  logActivity,
  type VerificationInput,
} from "@market-outreach/core";
import { getRepos } from "./data";
import { isDemoMode } from "./demo";
import { getCurrentUser } from "./authActions";

/**
 * Recording what a person found when they checked a business themselves.
 *
 * Everything that decides what gets written is enforced here rather than in
 * the form, because a form is only a suggestion — anything can post to a
 * server action. In particular the provider must be one of the known values:
 * free text would give us "booksy", "Booksy" and "booksy.com" within a week,
 * and the filter that shows which platform a business uses would quietly split
 * into three.
 */

const PROVIDERS = new Set<string>([...KNOWN_BOOKING_PROVIDERS, "none"]);

/** Only same-origin paths, so a hand-edited form cannot bounce someone off-site. */
function safeReturn(value: unknown, fallback: string): string {
  const path = typeof value === "string" ? value : "";
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}

export async function verifyLeadAction(form: FormData): Promise<void> {
  if (isDemoMode) return;

  const leadId = String(form.get("leadId") ?? "").trim();
  if (!leadId) return;

  const repos = getRepos();
  const lead = await repos.leads.getById(leadId);
  if (!lead) return;

  /**
   * Attribution is not optional.
   *
   * The point of this feature is that the work can be delegated and paid for,
   * and an answer nobody's name is on cannot be spot-checked. If there is no
   * session — which only happens on a deployment with auth switched off —
   * nothing is written rather than an answer being filed under nobody.
   */
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/leads/${leadId}?error=${encodeURIComponent("Sign in before recording a check — answers are attributed.")}`);
  }

  const websiteAnswer = String(form.get("hasWebsite") ?? "");
  const providerAnswer = String(form.get("bookingProvider") ?? "");

  const input: VerificationInput = {
    verifiedBy: user.email,
    verifiedAt: new Date().toISOString(),
    note: String(form.get("note") ?? "").slice(0, 500),
  };

  // "" means "leave this alone", which is a real answer for someone who only
  // established one of the two facts.
  if (websiteAnswer === "yes" || websiteAnswer === "no") {
    input.hasWebsite = websiteAnswer === "yes";
    input.website = String(form.get("website") ?? "").trim() || null;
  }
  if (providerAnswer && PROVIDERS.has(providerAnswer)) {
    input.bookingProvider = providerAnswer;
  }

  if (input.hasWebsite === undefined && input.bookingProvider === undefined && !input.note?.trim()) {
    redirect(`/leads/${leadId}?error=${encodeURIComponent("Nothing was filled in, so nothing was recorded.")}`);
  }

  const { lead: updated, changes } = applyVerification(lead, input);

  // Re-scored on the new facts, so a hand-checked lead ranks against the rest
  // on the same basis. Skipped when the booking question is still open —
  // scoring an unanswered lead would be scoring a guess.
  if (updated.onlineBookingStatus !== "UNKNOWN") {
    const scored = await scoreLead(updated, getScoringConfig(), new MockReasoningProvider());
    updated.prospectScore = scored.score;
    updated.scoreBreakdown = scored.breakdown;
    updated.scoreReason = scored.scoreReason;
    // A person who has seen the business is the best evidence available, so
    // this is the one path that may claim high confidence.
    updated.dataConfidence = "HIGH";
    updated.qualificationStatus = qualificationStatusForScore(scored.score, getScoringConfig());
  }

  await repos.leads.upsert(updated);

  try {
    await logActivity(repos.agentActivity, {
      agentId: "researcher",
      leadId: updated.id,
      action: "manual_verification",
      summary: `${user.email} checked ${updated.businessName}: ${changes.join("; ") || "note only"}.`,
    });
  } catch {
    // The answer is already saved; failing to log must not lose it.
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");

  // Back to wherever they came from, so working through a filtered list of a
  // town does not throw someone back to the top of the leads page each time.
  const next = safeReturn(form.get("returnTo"), `/leads/${leadId}`);
  redirect(next);
}
