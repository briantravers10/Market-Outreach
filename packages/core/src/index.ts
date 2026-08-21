export * from "./types";
export * from "./config";

export { ProspectingManager } from "./prospectingManager";
export type { ProspectingManagerDeps, CreateCampaignInput, JobRunResult, AssignTaskResult } from "./prospectingManager";

export { DeterministicCommandParser } from "./nlp/commandParser";
export type { CommandParser } from "./nlp/commandParser";
export type { ParsedCommand } from "./nlp/intentTypes";

export { JobQueueManager } from "./queue/jobQueueManager";

export { MockDiscoveryProvider } from "./providers/discoveryProvider";
export type { DiscoveryProvider, DiscoveryParams } from "./providers/discoveryProvider";

export { MockEnrichmentProvider } from "./providers/enrichmentProvider";
export type { EnrichmentProvider, EnrichmentResult } from "./providers/enrichmentProvider";

export { MockReasoningProvider } from "./reasoning/reasoningProvider";
export type { ReasoningProvider } from "./reasoning/reasoningProvider";

export { hashPassword, verifyPassword, validatePasswordStrength } from "./auth/password";
export {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE,
  DEFAULT_SESSION_TTL_SECONDS,
} from "./auth/session";
export type { SessionPayload } from "./auth/session";
export { generateResetToken, hashResetToken, resetTokenMatches, RESET_TOKEN_TTL_MINUTES } from "./auth/resetTokens";

export { classifyLink, analyzeLinks } from "./enrichment/linkClassifier";
export type { DetectedLink, LinkPurpose, LinkAnalysis } from "./enrichment/linkClassifier";
export { MockLinkInBioProvider, buildProfile, mockBioUrl } from "./providers/linkInBioProvider";
export type { LinkInBioProvider, LinkInBioProfile, RawBioLink } from "./providers/linkInBioProvider";

export { MockCrmAdapter } from "./crm/crmAdapter";
export type { CrmAdapter } from "./crm/crmAdapter";
export {
  PipedriveCrmAdapter,
  buildHandoff,
  buildOrganizationPayload,
  buildPersonPayload,
  buildDealPayload,
  describePipedriveMode,
} from "./crm/pipedriveAdapter";
export type {
  PipedriveHandoff,
  PipedrivePayload,
  PipedriveSkippedField,
  PipedriveMode,
  PipedriveModeReason,
} from "./crm/pipedriveAdapter";

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
  buildBreakdown,
  buildWebsiteStatusBreakdown,
  buildBookingStatusBreakdown,
  buildBookingProviderBreakdown,
  buildConfidenceBreakdown,
  buildAgentThroughput,
} from "./workers/reportingWorker";
export type { OverallSummary, ProgressBucket, CountBreakdown, AgentThroughput } from "./workers/reportingWorker";

export { logActivity } from "./agents/agentActivity";
export type { LogActivityInput } from "./agents/agentActivity";
export { summarizeAgent, summarizeAllAgents } from "./agents/agentRegistry";
export type { AgentSummary, AgentLiveStatus } from "./agents/agentRegistry";
