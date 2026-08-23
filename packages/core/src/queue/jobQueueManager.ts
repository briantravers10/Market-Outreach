import type { Job, JobsRepository, JobStatus } from "../types";

const nowIso = () => new Date().toISOString();

/**
 * Work-queue manager: CITY + INDUSTRY + BATCH jobs with a resumable status
 * lifecycle. Storage-agnostic — takes a JobsRepository (SQLite locally,
 * Postgres in deployment) so this class has no direct DB dependency.
 */
export class JobQueueManager {
  constructor(private readonly jobsRepo: JobsRepository) {}

  async enqueue(input: { id: string; campaignId: string; city: string; industry: string; batchId: string }): Promise<Job> {
    return await this.jobsRepo.create({
      ...input,
      status: "pending",
      payload: {},
      attempts: 0,
      error: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  async claimNextPending(): Promise<Job | null> {
    const job = await this.jobsRepo.claimNextPending();
    if (!job) return null;
    return await this.setStatus(job, "running");
  }

  async checkpoint(job: Job, payload: Record<string, unknown>): Promise<Job> {
    return await this.jobsRepo.update({ ...job, payload: { ...job.payload, ...payload }, updatedAt: nowIso() });
  }

  async markComplete(job: Job): Promise<Job> {
    return await this.setStatus(job, "complete");
  }

  async markFailed(job: Job, error: string): Promise<Job> {
    return await this.jobsRepo.update({
      ...job,
      status: "failed",
      error,
      attempts: job.attempts + 1,
      updatedAt: nowIso(),
    });
  }

  async markRetry(job: Job, error: string): Promise<Job> {
    return await this.jobsRepo.update({
      ...job,
      status: "retry",
      error,
      attempts: job.attempts + 1,
      updatedAt: nowIso(),
    });
  }

  async markHumanReview(job: Job, reason: string): Promise<Job> {
    return await this.jobsRepo.update({ ...job, status: "human_review", error: reason, updatedAt: nowIso() });
  }

  async pause(job: Job): Promise<Job> {
    return await this.setStatus(job, "paused");
  }

  async resume(job: Job): Promise<Job> {
    return await this.setStatus(job, "pending");
  }

  async requeue(job: Job): Promise<Job> {
    return await this.jobsRepo.update({ ...job, status: "pending", error: null, updatedAt: nowIso() });
  }

  async list(filter?: { campaignId?: string; status?: JobStatus; city?: string; industry?: string }): Promise<Job[]> {
    return await this.jobsRepo.list(filter);
  }

  private async setStatus(job: Job, status: JobStatus): Promise<Job> {
    return await this.jobsRepo.update({ ...job, status, updatedAt: nowIso() });
  }
}
