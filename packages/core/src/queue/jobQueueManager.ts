import type { Job, JobsRepository, JobStatus } from "../types";

const nowIso = () => new Date().toISOString();

/**
 * Work-queue manager: CITY + INDUSTRY + BATCH jobs with a resumable status
 * lifecycle. Storage-agnostic — takes a JobsRepository (SQLite today,
 * anything later) so this class has no direct DB dependency.
 */
export class JobQueueManager {
  constructor(private readonly jobsRepo: JobsRepository) {}

  enqueue(input: { id: string; campaignId: string; city: string; industry: string; batchId: string }): Job {
    return this.jobsRepo.create({
      ...input,
      status: "pending",
      payload: {},
      attempts: 0,
      error: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  claimNextPending(): Job | null {
    const job = this.jobsRepo.claimNextPending();
    if (!job) return null;
    return this.setStatus(job, "running");
  }

  checkpoint(job: Job, payload: Record<string, unknown>): Job {
    return this.jobsRepo.update({ ...job, payload: { ...job.payload, ...payload }, updatedAt: nowIso() });
  }

  markComplete(job: Job): Job {
    return this.setStatus(job, "complete");
  }

  markFailed(job: Job, error: string): Job {
    return this.jobsRepo.update({
      ...job,
      status: "failed",
      error,
      attempts: job.attempts + 1,
      updatedAt: nowIso(),
    });
  }

  markRetry(job: Job, error: string): Job {
    return this.jobsRepo.update({
      ...job,
      status: "retry",
      error,
      attempts: job.attempts + 1,
      updatedAt: nowIso(),
    });
  }

  markHumanReview(job: Job, reason: string): Job {
    return this.jobsRepo.update({ ...job, status: "human_review", error: reason, updatedAt: nowIso() });
  }

  pause(job: Job): Job {
    return this.setStatus(job, "paused");
  }

  resume(job: Job): Job {
    return this.setStatus(job, "pending");
  }

  requeue(job: Job): Job {
    return this.jobsRepo.update({ ...job, status: "pending", error: null, updatedAt: nowIso() });
  }

  list(filter?: { campaignId?: string; status?: JobStatus; city?: string; industry?: string }): Job[] {
    return this.jobsRepo.list(filter);
  }

  private setStatus(job: Job, status: JobStatus): Job {
    return this.jobsRepo.update({ ...job, status, updatedAt: nowIso() });
  }
}
