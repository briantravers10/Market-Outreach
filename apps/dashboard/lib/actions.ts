"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { getTerritories, logActivity, parseInstructionEffect, type AgentId } from "@market-outreach/core";
import { getCommandParser, getManager, getRepos } from "./data";
import { isDemoMode } from "./demo";

/**
 * Campaign/job control server actions. These mutate ONLY local SQLite
 * test/mock data — no external systems, no outreach, no live research.
 *
 * On the public read-only demo deploy (DEMO_READ_ONLY=1), every action is a
 * no-op: the underlying database is opened read-only there (see
 * packages/db/src/client.ts), so writes would throw. The dashboard also
 * hides/disables these controls in demo mode — see components/ActionButton.tsx —
 * this early return is the belt-and-braces backstop.
 */

export async function startCampaignAction(campaignId: string) {
  if (isDemoMode) return;
  await getManager().startCampaign(campaignId);
  revalidatePath("/campaigns");
  revalidatePath("/queue");
  revalidatePath("/overview");
  revalidatePath("/team");
}

export async function pauseCampaignAction(campaignId: string) {
  if (isDemoMode) return;
  await getManager().pauseCampaign(campaignId);
  revalidatePath("/campaigns");
  revalidatePath("/queue");
  revalidatePath("/team");
}

export async function resumeCampaignAction(campaignId: string) {
  if (isDemoMode) return;
  await getManager().resumeCampaign(campaignId);
  revalidatePath("/campaigns");
  revalidatePath("/queue");
  revalidatePath("/team");
}

export async function stopCampaignAction(campaignId: string) {
  if (isDemoMode) return;
  await getManager().stopCampaign(campaignId);
  revalidatePath("/campaigns");
  revalidatePath("/queue");
  revalidatePath("/team");
}

export async function runNextJobAction(campaignId: string) {
  if (isDemoMode) return;
  const repos = getRepos();
  const manager = getManager();
  const nextPending = (await repos.jobs.list({ campaignId, status: "pending" }))[0];
  if (nextPending) {
    await manager.runJob(nextPending);
  }
  revalidatePath("/campaigns");
  revalidatePath("/queue");
  revalidatePath("/overview");
  revalidatePath("/leads");
  revalidatePath("/high-priority");
  revalidatePath("/analytics");
  revalidatePath("/team");
}

export async function requeueJobAction(jobId: string) {
  if (isDemoMode) return;
  const repos = getRepos();
  const job = await repos.jobs.getById(jobId);
  if (job) {
    getManager().queue.requeue(job);
  }
  revalidatePath("/queue");
}

export async function createCampaignAction(formData: FormData) {
  if (isDemoMode) return;
  const city = String(formData.get("city"));
  const industry = String(formData.get("industry"));
  const name = String(formData.get("name") || `${city} — ${industry}`);
  const batchSize = Number(formData.get("batchSize") || 5);
  const targetLeadCount = Number(formData.get("targetLeadCount") || 15);
  const priority = Number(formData.get("priority") || 3);

  await getManager().createCampaign({ name, city, industry, batchSize, targetLeadCount, priority });
  revalidatePath("/campaigns");
  revalidatePath("/queue");
}

/**
 * The Manager Command Box: turns free text into a campaign, or redirects
 * back with a clarification message when the city/industry can't be
 * confidently determined. Redirect-with-query-param is used instead of a
 * client-side form-state hook so the whole dashboard can stay server
 * components — consistent with the rest of the app.
 */
export async function assignTaskAction(formData: FormData) {
  const text = String(formData.get("command") || "").trim();
  if (isDemoMode) {
    redirect(`/campaigns?clarify=${encodeURIComponent("Assigning tasks is disabled in the public read-only demo.")}`);
  }
  if (!text) {
    redirect(`/campaigns?clarify=${encodeURIComponent("Type an instruction first, e.g. \"Find 50 dog groomers in Miami with no online booking.\"")}`);
  }

  const result = await getManager().assignTask(text, getCommandParser());
  revalidatePath("/campaigns");
  revalidatePath("/queue");
  revalidatePath("/overview");
  revalidatePath("/team");

  if (!result.campaign) {
    redirect(`/campaigns?clarify=${encodeURIComponent(result.parsed.clarification ?? "Couldn't understand that request.")}`);
  }
  redirect(`/campaigns?assigned=${encodeURIComponent(result.campaign.name)}`);
}

/**
 * Direct per-agent instruction box.
 *
 * Goes through the same instruction system the Manager uses, so an order given
 * here is a real, versioned instruction — enforced if it maps to a pipeline
 * effect, advisory otherwise — rather than a note on an activity feed. Having
 * two different meanings for "give this employee an instruction" depending on
 * which box you typed into would be a trap.
 *
 * Scope defaults to permanent here, unlike in conversation: this box is on the
 * employee's own page under the heading "Standing instruction", so the intent
 * is unambiguous in a way a spoken sentence isn't.
 */
export async function sendAgentCommandAction(agentId: AgentId, formData: FormData) {
  if (isDemoMode) return;
  const text = String(formData.get("command") || "").trim();
  if (!text) return;

  const repos = getRepos();
  const now = new Date();
  const effect = parseInstructionEffect(text, { knownCities: getTerritories().map((t) => t.city) });

  // Same supersede-don't-stack rule the Manager applies, so a contradictory
  // order given here can't sit alongside one given in conversation.
  const conflicting = effect
    ? (await repos.instructions.list({ agentId, scope: "permanent", status: "active" })).filter(
        (i) => i.effect?.kind === effect.kind
      )
    : [];

  const instruction = {
    id: randomUUID(),
    agentId,
    instruction: text,
    scope: "permanent" as const,
    status: "active" as const,
    effect,
    effectKind: effect?.kind ?? null,
    rationale: null,
    source: "agent_page",
    conversationId: null,
    messageId: null,
    createdBy: "owner",
    version: conflicting.length ? Math.max(...conflicting.map((c) => c.version)) + 1 : 1,
    supersedesId: conflicting[0]?.id ?? null,
    supersededById: null,
    campaignId: null,
    expiresAt: null,
    createdAt: now.toISOString(),
    revokedAt: null,
    revokedReason: null,
  };
  await repos.instructions.create(instruction);
  for (const old of conflicting) {
    await repos.instructions.update({ ...old, status: "superseded", supersededById: instruction.id });
  }

  await logActivity(repos.agentActivity, {
    agentId,
    action: "direct_instruction",
    summary: `Instruction from you: "${text}" — ${effect ? "enforced" : "advisory"}.`,
    level: "info",
  });
  revalidatePath(`/team/${agentId}`);
  revalidatePath("/team");
  revalidatePath("/manager/instructions");
  revalidatePath("/manager/employees");
}
