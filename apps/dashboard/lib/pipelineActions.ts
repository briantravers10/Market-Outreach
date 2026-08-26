"use server";

import { revalidatePath } from "next/cache";
import { PipedriveCrmAdapter } from "@market-outreach/core";
import { getRepos } from "./data";
import { isDemoMode } from "./demo";

/**
 * Working a deal.
 *
 * Every one of these writes to Pipedrive and nowhere else. That is the whole
 * point of the design: Pipedrive owns the conversation — calls, notes, stages
 * — and this dashboard owns finding and judging. A call log kept in both
 * places is two versions of what was said, and the owner would rightly stop
 * trusting both.
 *
 * So there is no local copy to update, and nothing here can drift. What the
 * dashboard shows is whatever Pipedrive answered when the page loaded.
 */

function adapter() {
  return new PipedriveCrmAdapter(getRepos().crm);
}

/** Refresh everywhere a deal's state is visible. */
function revalidateAll(): void {
  revalidatePath("/pipeline");
  revalidatePath("/leads");
  revalidatePath("/crm");
  revalidatePath("/overview");
}

export async function addLeadToCrmAction(formData: FormData): Promise<void> {
  if (isDemoMode) return;
  const leadId = String(formData.get("leadId") ?? "");
  if (!leadId) return;

  const repos = getRepos();
  const lead = await repos.leads.getById(leadId);
  if (!lead) return;

  await adapter().pushLead(lead);

  // Stamp the stage so the lead drops out of the working list. It has been
  // acted on; leaving it in the pile is how you end up calling it twice.
  await repos.leads.upsert({ ...lead, pipelineStage: "CRM" });

  revalidateAll();
  revalidatePath(`/leads/${leadId}`);
}

export async function logCallAction(formData: FormData): Promise<void> {
  if (isDemoMode) return;
  const leadId = String(formData.get("leadId") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!leadId || !subject) return;

  await adapter().logCall(leadId, { subject, note: note || null, type: "call" });
  revalidateAll();
  revalidatePath(`/leads/${leadId}`);
}

export async function addNoteAction(formData: FormData): Promise<void> {
  if (isDemoMode) return;
  const leadId = String(formData.get("leadId") ?? "");
  const content = String(formData.get("content") ?? "");
  if (!leadId) return;

  await adapter().addNote(leadId, content);
  revalidateAll();
  revalidatePath(`/leads/${leadId}`);
}

export async function moveStageAction(formData: FormData): Promise<void> {
  if (isDemoMode) return;
  const leadId = String(formData.get("leadId") ?? "");
  const stageId = Number.parseInt(String(formData.get("stageId") ?? ""), 10);
  if (!leadId || !Number.isFinite(stageId)) return;

  await adapter().moveDealToStage(leadId, stageId);
  revalidateAll();
  revalidatePath(`/leads/${leadId}`);
}
