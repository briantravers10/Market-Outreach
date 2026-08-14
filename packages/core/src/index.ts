export * from "./types";
export * from "./config";

export { ProspectingManager } from "./prospectingManager";
export type { ProspectingManagerDeps, CreateCampaignInput, JobRunResult } from "./prospectingManager";

export { JobQueueManager } from "./queue/jobQueueManager";

export { MockDiscoveryProvider } from "./providers/discoveryProvider";
export type { DiscoveryProvider, DiscoveryParams } from "./providers/discoveryProvider";

export { MockEnrichmentProvider } from "./providers/enrichmentProvider";
export type { EnrichmentProvider, EnrichmentResult } from "./providers/enrichmentProvider";

export { MockReasoningProvider } from "./reasoning/reasoningProvider";
export type { ReasoningProvider } from "./reasoning/reasoningProvider";

export { MockCrmAdapter } from "./crm/crmAdapter";
export type { CrmAdapter } from "./crm/crmAdapter";

export { DisabledOutreachService } from "./outreach/outreachService";
export type { OutreachService } from "./outreach/outreachService";

export { scoreLead, computeDataConfidence, qualificationStatusForScore } from "./scoring/scoringEngine";

export { runDiscoveryWorker } from "./workers/discoveryWorker";
export { runEnrichmentWorker } from "./workers/enrichmentWorker";
export { runWebsiteBookingAnalysisWorker, explainWebsiteBookingAnalysis } from "./workers/websiteBookingAnalysisWorker";
export { runQualificationWorker } from "./workers/qualificationWorker";
export { findLikelyDuplicate } from "./workers/dedupWorker";
export {
  buildOverallSummary,
  buildProgressByCity,
  buildProgressByIndustry,
  buildCampaignProgress,
} from "./workers/reportingWorker";
export type { OverallSummary, ProgressBucket } from "./workers/reportingWorker";
