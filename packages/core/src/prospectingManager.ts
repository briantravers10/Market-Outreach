import { randomUUID } from "node:crypto";
import type { AgentActivityLevel, AgentId, Campaign, Job, Lead, PipelineStageName, Repositories } from "./types";
import type { DiscoveryProvider } from "./providers/discoveryProvider";
import type { EnrichmentProvider } from "./providers/enrichmentProvider";
import type { ReasoningProvider } from "./reasoning/reasoningProvider";
import type { CrmAdapter } from "./crm/crmAdapter";
import { getIndustries, type ScoringConfig, type Territory } from "./config";
import { JobQueueManager } from "./queue/jobQueueManager";
import { runDiscoveryWorker } from "./workers/discoveryWorker";
import { runEnrichmentWorker } from "./workers/enrichmentWorker";
import { explainWebsiteBookingAnalysis, runWebsiteBookingAnalysisWorker } from "./workers/websiteBookingAnalysisWorker";
import { runQualificationWorker } from "./workers/qualificationWorker";
import { describeDuplicateMatch, findLikelyDuplicate } from "./workers/dedupWorker";
import { makeSeededRandom, chance } from "./mockData/random";
import { logActivity } from "./agents/agentActivity";
import type { CommandParser } from "./nlp/commandParser";
import type { ParsedCommand } from "./nlp/intentTypes";

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
  /** Human-readable filter phrases, e.g. from the Manager's natural-language command parser. */
  filters?: string[];
  /** The raw natural-language instruction that produced this campaign, if any. */
  sourceCommand?: string | null;
}

export interface JobRunResult {
  job: Job;
  outcome: "complete" | "failed" | "retry" | "human_review";
  leadsCreated: number;
}

export interface AssignTaskResult {
  parsed: ParsedCommand;
  campaign: Campaign | null;
  jobs: Job[];
}

const nowIso = () => new Date().toISOString();

function industryLabel(industryId: string): string {
  return getIndustries().find((i) => i.id === industryId)?.label ?? industryId;
}

/**
 * Prospecting Manager — the top-level orchestrator. Owns campaigns, batch
 * size, and job creation; drives each job through
 * DISCOVER -> ENRICH -> ANALYZE -> QUALIFY -> DEDUP -> STORE.
 * Reporting is read separately (packages/core/src/workers/reportingWorker.ts)
 * straight off stored leads/jobs, so it never goes stale mid-run.
 *
 * Phase 2: every stage also writes an agent_activity row attributed to the
 * matching persona (Scout/Researcher/Website Analyst/Qualifier/Deduplication/
 * Reporting) — this is what the dashboard's "AI Team" status/current-task
 * views read from. See packages/core/src/agents/agentRegistry.ts.
 */
export class ProspectingManager {
  readonly queue: JobQueueManager;

  constructor(private readonly deps: ProspectingManagerDeps) {
    this.queue = new JobQueueManager(deps.repos.jobs);
  }

  private log(agentId: AgentId, summary: string, opts: {
    action?: string;
    campaignId?: string | null;
    jobId?: string | null;
    leadId?: string | null;
    level?: AgentActivityLevel;
  } = {}) {
    logActivity(this.deps.repos.agentActivity, {
      agentId,
      action: opts.action ?? "activity",
      summary,
      campaignId: opts.campaignId ?? null,
      jobId: opts.jobId ?? null,
      leadId: opts.leadId ?? null,
      level: opts.level ?? "info",
    });
  }

  createCampaign(input: CreateCampaignInput): { campaign: Campaign; jobs: Job[] } {
    const territory = this.deps.territories.find((t) => t.city === input.city);
    if (!territory) throw new Error(`Unknown territory city: ${input.city}`);

    const filters = input.filters ?? [];
    const campaign = this.deps.repos.campaigns.create({
      id: randomUUID(),
      name: input.name,
      city: input.city,
      industry: input.industry,
      status: "draft",
      batchSize: input.batchSize,
      priority: input.priority,
      targetLeadCount: input.targetLeadCount,
      filters,
      sourceCommand: input.sourceCommand ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: null,
      completedAt: null,
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

    const filterNote = filters.length ? ` Filters: ${filters.join(", ")}.` : "";
    this.log(
      "manager",
      `Assigned: ${input.city} — ${industryLabel(input.industry)}, target ${input.targetLeadCount}.${filterNote}`,
      { action: "create_campaign", campaignId: campaign.id }
    );

    return { campaign, jobs };
  }

  /**
   * The Manager Command Box entry point: turns a free-text instruction into
   * a campaign via `parser` (deterministic pattern-matching this phase —
   * see nlp/commandParser.ts), or returns a clarification request instead
   * of guessing when the city/industry can't be confidently determined.
   */
  assignTask(text: string, parser: CommandParser): AssignTaskResult {
    const parsed = parser.parse(text);

    if (parsed.confidence === "NEEDS_CLARIFICATION" || !parsed.industryId || !parsed.city) {
      this.log("manager", `Needs clarification: "${text}" — ${parsed.clarification}`, {
        action: "assign_task_unclear",
      });
      return { parsed, campaign: null, jobs: [] };
    }

    const { campaign, jobs } = this.createCampaign({
      name: `${parsed.city} — ${parsed.industryLabel}`,
      city: parsed.city,
      industry: parsed.industryId,
      batchSize: 5,
      priority: 3,
      targetLeadCount: parsed.targetQuantity,
      filters: parsed.filters,
      sourceCommand: text,
    });

    return { parsed, campaign, jobs };
  }

  startCampaign(campaignId: string): Campaign {
    const existing = this.deps.repos.campaigns.getById(campaignId);
    const extra = existing && !existing.startedAt ? { startedAt: nowIso() } : {};
    const campaign = this.setCampaignStatus(campaignId, "running", extra);
    this.log("manager", `Started campaign: ${campaign.city} — ${industryLabel(campaign.industry)}.`, {
      action: "start_campaign",
      campaignId,
    });
    return campaign;
  }

  pauseCampaign(campaignId: string): Campaign {
    const campaign = this.setCampaignStatus(campaignId, "paused");
    for (const job of this.deps.repos.jobs.list({ campaignId, status: "pending" })) {
      this.queue.pause(job);
    }
    this.log("manager", `Paused campaign: ${campaign.city} — ${industryLabel(campaign.industry)}.`, {
      action: "pause_campaign",
      campaignId,
    });
    return campaign;
  }

  resumeCampaign(campaignId: string): Campaign {
    const campaign = this.setCampaignStatus(campaignId, "running");
    for (const job of this.deps.repos.jobs.list({ campaignId, status: "paused" })) {
      this.queue.resume(job);
    }
    this.log("manager", `Resumed campaign: ${campaign.city} — ${industryLabel(campaign.industry)}.`, {
      action: "resume_campaign",
      campaignId,
    });
    return campaign;
  }

  stopCampaign(campaignId: string): Campaign {
    const campaign = this.setCampaignStatus(campaignId, "stopped");
    this.log("manager", `Stopped campaign: ${campaign.city} — ${industryLabel(campaign.industry)}.`, {
      action: "stop_campaign",
      campaignId,
    });
    return campaign;
  }

  private setCampaignStatus(campaignId: string, status: Campaign["status"], extra: Partial<Campaign> = {}): Campaign {
    const campaign = this.deps.repos.campaigns.getById(campaignId);
    if (!campaign) throw new Error(`Unknown campaign: ${campaignId}`);
    return this.deps.repos.campaigns.update({ ...campaign, ...extra, status, updatedAt: nowIso() });
  }

  /** Marks a campaign complete (with a completedAt stamp) once it has no pending/running jobs left. */
  private maybeCompleteCampaign(campaignId: string) {
    const campaign = this.deps.repos.campaigns.getById(campaignId);
    if (!campaign || campaign.status !== "running") return;
    const jobs = this.deps.repos.jobs.list({ campaignId });
    const unfinished = jobs.some((j) => j.status === "pending" || j.status === "running");
    if (unfinished || jobs.length === 0) return;
    this.deps.repos.campaigns.update({ ...campaign, status: "complete", completedAt: nowIso(), updatedAt: nowIso() });
    this.log("manager", `Campaign complete: ${campaign.city} — ${industryLabel(campaign.industry)}.`, {
      action: "complete_campaign",
      campaignId,
    });
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
        const reason = "Scout found 0 candidate businesses for this batch.";
        const reviewed = this.queue.markHumanReview(current, reason);
        this.deps.repos.humanReview.create({
          id: randomUUID(),
          jobId: job.id,
          leadId: null,
          agentId: "scout",
          reason,
          status: "open",
          createdAt: nowIso(),
          resolvedAt: null,
        });
        this.log("scout", reason, { action: "discovery_empty", campaignId: job.campaignId, jobId: job.id, level: "human_review" });
        return { job: reviewed, outcome: "human_review", leadsCreated: 0 };
      }

      this.log("scout", `Found ${seeds.length} candidate businesses in ${job.city} for ${industryLabel(job.industry)}.`, {
        action: "discover",
        campaignId: job.campaignId,
        jobId: job.id,
      });

      let leadsCreated = 0;
      const existingLeadsInCity = this.deps.repos.leads.list({ city: job.city });

      for (const seed of seeds) {
        const enrichment = await runEnrichmentWorker(seed, job.id, this.deps.enrichment);
        this.log(
          "researcher",
          `Researched ${seed.businessName} — ${enrichment.fieldsResolved.length}/7 key fields found.`,
          { action: "enrich", campaignId: job.campaignId, jobId: job.id }
        );

        const analysis = runWebsiteBookingAnalysisWorker(seed.businessName, enrichment, job.id);
        const analysisReason = await explainWebsiteBookingAnalysis(seed.businessName, analysis, this.deps.reasoning);
        this.log(
          "website-analyst",
          `Assessed ${seed.businessName}: ${analysis.websiteQuality.toLowerCase()} website, ${analysis.bookingMethod
            .toLowerCase()
            .replace(/_/g, " ")} booking.`,
          { action: "analyze_website", campaignId: job.campaignId, jobId: job.id }
        );

        const stagesCompleted: PipelineStageName[] = ["discovery", "enrichment", "website_analysis"];
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
          linkInBioUrl: enrichment.linkInBioUrl,
          detectedLinks: enrichment.detectedLinks,
          serviceArea: enrichment.serviceArea,
          locationConfidence: enrichment.locationConfidence,
          locationEvidence: enrichment.locationEvidence,
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
          isDuplicateOf: null,
          stagesCompleted,
          notes: analysisReason,
        };

        // Persist the base row now — score_results/agent_activity below reference
        // lead.id via a foreign key, so the lead must exist before anything else
        // can point at it.
        this.deps.repos.leads.upsert(lead);

        // Qualify first (every lead gets a transparent score), then dedup — matches the
        // Manager -> Scout -> Researcher -> Website Analyst -> Qualifier -> Deduplication
        // pipeline order. A duplicate still shows its computed score; it's just also
        // flagged and disqualified, rather than silently skipped.
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
          stagesCompleted: [...stagesCompleted, "qualification"],
        };
        this.deps.repos.scoreResults.create({
          id: randomUUID(),
          leadId: lead.id,
          score: scoreResult.score,
          breakdown: scoreResult.breakdown,
          confidence: scoreResult.confidence,
          confidenceReason: scoreResult.confidenceReason,
          scoreReason: scoreResult.scoreReason,
          scoringConfigVersion: this.deps.scoringConfig.version,
          scoredAt: nowIso(),
        });
        this.log("qualifier", `Scored ${seed.businessName}: ${scoreResult.score}/100 (${qualificationStatus.replace(/_/g, " ").toLowerCase()}).`, {
          action: "qualify",
          campaignId: job.campaignId,
          jobId: job.id,
          leadId: lead.id,
        });

        const dedupCandidate = {
          businessName: seed.businessName,
          address: seed.address,
          phone: enrichment.phone,
          city: seed.city,
          website: enrichment.website,
          instagram: enrichment.instagram,
        };
        const duplicate = findLikelyDuplicate(dedupCandidate, existingLeadsInCity);
        if (duplicate) {
          const matchReason = describeDuplicateMatch(dedupCandidate, duplicate);
          lead.qualificationStatus = "DISQUALIFIED";
          lead.isDuplicateOf = duplicate.id;
          lead.notes = `${analysisReason} Flagged as likely duplicate of "${duplicate.businessName}" (${duplicate.id}) — ${matchReason}.`;
          this.log("deduplication", `Flagged ${seed.businessName} as a likely duplicate of "${duplicate.businessName}" (${matchReason}).`, {
            action: "dedup_flagged",
            campaignId: job.campaignId,
            jobId: job.id,
            leadId: lead.id,
          });
        } else {
          this.log("deduplication", `Checked ${seed.businessName} for duplicates — none found.`, {
            action: "dedup_checked",
            campaignId: job.campaignId,
            jobId: job.id,
            leadId: lead.id,
          });
        }
        lead.stagesCompleted = [...lead.stagesCompleted, "deduplication"];

        this.deps.repos.leads.upsert(lead);

        if (!duplicate && (qualificationStatus === "QUALIFIED" || qualificationStatus === "HIGH_PRIORITY")) {
          await this.deps.crm.pushLead(lead);
          lead.pipelineStage = "CRM";
          this.deps.repos.leads.upsert(lead);
        }

        existingLeadsInCity.push(lead);
        leadsCreated += 1;
        current = this.queue.checkpoint(current, { leadsProcessed: leadsCreated, totalSeeds: seeds.length });
      }

      const completed = this.queue.markComplete(current);
      this.log("reporting", `Recorded results for ${job.city} — ${industryLabel(job.industry)} ${job.batchId}: ${leadsCreated} leads processed.`, {
        action: "record_batch",
        campaignId: job.campaignId,
        jobId: job.id,
      });
      this.maybeCompleteCampaign(job.campaignId);
      return { job: completed, outcome: "complete", leadsCreated };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (current.attempts < 2) {
        this.log("manager", `Retrying ${job.city} — ${industryLabel(job.industry)} ${job.batchId}: ${message}`, {
          action: "job_retry",
          campaignId: job.campaignId,
          jobId: job.id,
          level: "error",
        });
        return { job: this.queue.markRetry(current, message), outcome: "retry", leadsCreated: 0 };
      }
      this.deps.repos.humanReview.create({
        id: randomUUID(),
        jobId: job.id,
        leadId: null,
        agentId: "manager",
        reason: message,
        status: "open",
        createdAt: nowIso(),
        resolvedAt: null,
      });
      this.log("manager", `Failed ${job.city} — ${industryLabel(job.industry)} ${job.batchId}: ${message}`, {
        action: "job_failed",
        campaignId: job.campaignId,
        jobId: job.id,
        level: "error",
      });
      return { job: this.queue.markFailed(current, message), outcome: "failed", leadsCreated: 0 };
    }
  }
}
