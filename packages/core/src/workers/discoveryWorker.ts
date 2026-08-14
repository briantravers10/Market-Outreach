import type { DiscoveredLeadSeed, Job } from "../types";
import type { DiscoveryProvider } from "../providers/discoveryProvider";

/**
 * Discovery Worker — finds candidate businesses for a job's city+industry.
 * Deterministic orchestration code; the actual "finding" is delegated to a
 * DiscoveryProvider (mock now, real search/API later).
 */
export async function runDiscoveryWorker(
  job: Job,
  provider: DiscoveryProvider,
  state: string,
  batchSize: number
): Promise<DiscoveredLeadSeed[]> {
  return provider.discover({
    city: job.city,
    state,
    industry: job.industry,
    batchId: job.batchId,
    batchSize,
  });
}
