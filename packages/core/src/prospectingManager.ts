import { randomUUID } from "node:crypto";
import type { Campaign, Job, Lead, Repositories } from "./types";
import type { DiscoveryProvider } from "./providers/discoveryProvider";
import type { EnrichmentProvider } from "./providers/enrichmentProvider";
import type { ReasoningProvider } from "./reasoning/reasoningProvider";
import type { CrmAdapter } from "./crm/crmAdapter";
import type { ScoringConfig, Territory } from "./config";
import { JobQueueManager } from "./queue/jobQueueManager";
import { runDiscoveryWorker } from "./workers/discoveryWorker";
import { runEnrichmentWorker } from "./workers/enrichmentWorker";
import { explainWebsiteBookingAnalysis, runWebsiteBookingAnalysisWorker } from "./workers/websiteBookingAnalysisWorker";
import { runQualificationWorker } from "./workers/qualificationWorker";
import { findLikelyDuplicate } from "./workers/dedupWorker";
import { makeSeededRandom, chance } from "./mockData/random";

export interface ProspectingManagerDeps {
  repos: Repositories;
  discovery: DiscoveryProvider;
  enrichment: EnrichmentProvider;
  reasoning: ReasoningProvider;
  crm: CrmAdapter;
  scoringConfig: ScoringConfig;
  territories: Territory[];
}

export interface CreateCampaignInput {
  name: string;
  city: string;
  industry: string;
  batchSize: number;
  priority: number;
  targetLeadCount: number;
}

export interface JobRunResult {
  job: Job;
  outcome: "complete" | "failed" | "retry" | "human_review";
  leadsCreated: number;
}

const nowIso = () => new Date().toISOString();

/**
 * Prospecting Manager — the top-level orchestrator. Owns campaigns, batch
 * size, and job creation; drives each job through
 * DISCOVER -> ENRICH -> ANALYZE -> QUALIFY -> DEDUP -> STORE.
 * Reporting is read separately (packages/core/src/workers/reportingWorker.ts)
 * straight off stored leads/jobs, so it never goes stale mid-run.
 */
export class ProspectingManager {
  readonly queue: JobQueueManager;

  constructor(private readonly deps: ProspectingManagerDeps) {
    this.queue = new JobQueueManager(deps.repos.jobs);
  }

  createCampaign(input: CreateCampaignInput): { campaign: Campaign; jobs: Job[] } {
    const territory = this.deps.territories.find((t) => t.city === input.city);
    if (!territory) throw new Error(`Unknown territory city: ${input.city}`);

    const campaign = this.deps.repos.campaigns.create({
      id: randomUUID(),
      name: input.name,
      city: input.city,
      industry: input.industry,
      status: "draft",
      batchSize: input.batchSize,
      priority: input.priority,
      targetLeadCount: input.targetLeadCount,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    const numBatches = Math.max(1, Math.ceil(input.targetLeadCount / input.batchSize));
    const jobs: Job[] = [];
    for (let i = 0; i < numBatches; i++) {
      const batchId = `batch-${String(i + 1).padStart(3, "0")}`;
      jobs.push(
        this.queue.enqueue({
          id: randomUUID(),
          campaignId: campaign.id,
          city: input.city,
          industry: input.industry,
          batchId,
        })
      );
    }

    return { campaign, jobs };
  }

  startCampaign(campaignId: string): Campaign {
    return this.setCampaignStatus(campaignId, "running");
  }

  pauseCampaign(campaignId: string): Campaign {
    const campaign = this.setCampaignStatus(campaignId, "paused");
    for (const job of this.deps.repos.jobs.list({ campaignId, status: "pending" })) {
      this.queue.pause(job);
    }
    return campaign;
  }

  resumeCampaign(campaignId: string): Campaign {
    const campaign = this.setCampaignStatus(campaignId, "running");
    for (const job of this.deps.repos.jobs.list({ campaignId, status: "paused" })) {
      this.queue.resume(job);
    }
    return campaign;
  }

  stopCampaign(campaignId: string): Campaign {
    return this.setCampaignStatus(campaignId, "stopped");
  }

  private setCampaignStatus(campaignId: string, status: Campaign["status"]): Campaign {
    const campaign = this.deps.repos.campaigns.getById(campaignId);
    if (!campaign) throw new Error(`Unknown campaign: ${campaignId}`);
    return this.deps.repos.campaigns.update({ ...campaign, status, updatedAt: nowIso() });
  }

  /** Runs one pending job through the full pipeline. The job's own campaign must be "running". */
  async runJob(job: Job): Promise<JobRunResult> {
    const campaign = this.deps.repos.campaigns.getById(job.campaignId);
    if (!campaign || campaign.status !== "running") {
      return { job, outcome: "human_review", leadsCreated: 0 };
    }

    const territory = this.deps.territories.find((t) => t.city === job.city);
    const running = this.queue.list({ campaignId: job.campaignId }).find((j) => j.id === job.id) ?? job;
    let current = this.deps.repos.jobs.update({ ...running, status: "running", updatedAt: nowIso() });

    try {
      // Simulated transient failure, so the queue realistically shows Failed/Retry states.
      // Keyed on attempts too, so a retried job gets a fresh chance instead of faulting forever.
      if (chance(makeSeededRandom(`${job.id}|fault|${current.attempts}`), 0.08)) {
        throw new Error("Simulated transient research error (rate-limited by a mock data source).");
      }

      const seeds = await runDiscoveryWorker(current, this.deps.discovery, territory?.state ?? "FL", campaign.batchSize);
      if (seeds.length === 0) {
        const reviewed = this.queue.markHumanReview(current, "Discovery worker found 0 candidate businesses for this batch.");
        return { job: reviewed, outcome: "human_review", leadsCreated: 0 };
      }

      let leadsCreated = 0;
      const existingLeadsInCity = this.deps.repos.leads.list({ city: job.city });

      for (const seed of seeds) {
        const enrichment = await runEnrichmentWorker(seed, job.id, this.deps.enrichment);
        const analysis = runWebsiteBookingAnalysisWorker(seed.businessName, enrichment, job.id);
        const analysisReason = await explainWebsiteBookingAnalysis(seed.businessName, analysis, this.deps.reasoning);

        const duplicate = findLikelyDuplicate(
          { businessName: seed.businessName, address: seed.address, phone: enrichment.phone, city: seed.city },
          existingLeadsInCity
        );

        let lead: Lead = {
          id: randomUUID(),
          businessName: seed.businessName,
          industry: seed.industry,
          address: seed.address,
          city: seed.city,
          state: seed.state,
          zip: seed.zip,
          phone: enrichment.phone,
          email: enrichment.email,
          website: enrichment.website,
          websiteStatus: analysis.websiteStatus,
          websiteQuality: analysis.websiteQuality,
          onlineBookingStatus: analysis.onlineBookingStatus,
          bookingProvider: analysis.bookingProvider,
          bookingMethod: analysis.bookingMethod,
          staffCount: enrichment.staffCount,
          staffCountConfidence: enrichment.staffCountConfidence,
          rating: enrichment.rating,
          reviewCount: enrichment.reviewCount,
          instagram: enrichment.instagram,
          facebook: enrichment.facebook,
          socialActivity: enrichment.socialActivity,
          locationCount: enrichment.locationCount,
          services: enrichment.services,
          prospectScore: null,
          scoreBreakdown: [],
          scoreReason: null,
          dataConfidence: "LOW",
          discoverySource: seed.discoverySource,
          dateDiscovered: nowIso(),
          dateLastResearched: null,
          researchStatus: "ANALYZED",
          qualificationStatus: "UNQUALIFIED",
          pipelineStage: "RESEARCH",
          campaignId: job.campaignId,
          jobId: job.id,
          isDuplicateOf: duplicate?.id ?? null,
          notes: analysisReason,
        };

        if (duplicate) {
          lead.researchStatus = "COMPLETE";
          lead.qualificationStatus = "DISQUALIFIED";
          lead.notes = `${analysisReason} Flagged as likely duplicate of "${duplicate.businessName}" (${duplicate.id}).`;
        } else {
          const { scoreResult, qualificationStatus } = await runQualificationWorker(lead, this.deps.scoringConfig, this.deps.reasoning);
          lead = {
            ...lead,
            prospectScore: scoreResult.score,
            scoreBreakdown: scoreResult.breakdown,
            scoreReason: scoreResult.scoreReason,
            dataConfidence: scoreResult.confidence,
            qualificationStatus,
            researchStatus: "COMPLETE",
            dateLastResearched: nowIso(),
            pipelineStage: "QUALIFICATION",
          };

          this.deps.repos.leads.upsert(lead);

          if (qualificationStatus === "QUALIFIED" || qualificationStatus === "HIGH_PRIORITY") {
            await this.deps.crm.pushLead(lead);
            lead.pipelineStage = "CRM";
          }
        }

        this.deps.repos.leads.upsert(lead);
        existingLeadsInCity.push(lead);
        leadsCreated += 1;
        current = this.queue.checkpoint(current, { leadsProcessed: leadsCreated, totalSeeds: seeds.length });
      }

      const completed = this.queue.markComplete(current);
      return { job: completed, outcome: "complete", leadsCreated };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (current.attempts < 2) {
        return { job: this.queue.markRetry(current, message), outcome: "retry", leadsCreated: 0 };
      }
      return { job: this.queue.markFailed(current, message), outcome: "failed", leadsCreated: 0 };
    }
  }
}
