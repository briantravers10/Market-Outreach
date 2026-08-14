"use server";

import { revalidatePath } from "next/cache";
import { getManager, getRepos } from "./data";

/**
 * Campaign/job control server actions. These mutate ONLY local SQLite
 * test/mock data — no external systems, no outreach, no live research.
 */

export async function startCampaignAction(campaignId: string) {
  getManager().startCampaign(campaignId);
  revalidatePath("/campaigns");
  revalidatePath("/queue");
  revalidatePath("/overview");
}

export async function pauseCampaignAction(campaignId: string) {
  getManager().pauseCampaign(campaignId);
  revalidatePath("/campaigns");
  revalidatePath("/queue");
}

export async function resumeCampaignAction(campaignId: string) {
  getManager().resumeCampaign(campaignId);
  revalidatePath("/campaigns");
  revalidatePath("/queue");
}

export async function stopCampaignAction(campaignId: string) {
  getManager().stopCampaign(campaignId);
  revalidatePath("/campaigns");
  revalidatePath("/queue");
}

export async function runNextJobAction(campaignId: string) {
  const repos = getRepos();
  const manager = getManager();
  const nextPending = repos.jobs.list({ campaignId, status: "pending" })[0];
  if (nextPending) {
    await manager.runJob(nextPending);
  }
  revalidatePath("/campaigns");
  revalidatePath("/queue");
  revalidatePath("/overview");
  revalidatePath("/leads");
  revalidatePath("/high-priority");
  revalidatePath("/reports");
}

export async function requeueJobAction(jobId: string) {
  const repos = getRepos();
  const job = repos.jobs.getById(jobId);
  if (job) {
    getManager().queue.requeue(job);
  }
  revalidatePath("/queue");
}

export async function createCampaignAction(formData: FormData) {
  const city = String(formData.get("city"));
  const industry = String(formData.get("industry"));
  const name = String(formData.get("name") || `${city} — ${industry}`);
  const batchSize = Number(formData.get("batchSize") || 5);
  const targetLeadCount = Number(formData.get("targetLeadCount") || 15);
  const priority = Number(formData.get("priority") || 3);

  getManager().createCampaign({ name, city, industry, batchSize, targetLeadCount, priority });
  revalidatePath("/campaigns");
  revalidatePath("/queue");
}
