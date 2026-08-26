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

export { hashPassword, verifyPassword, validatePasswordStrength, hashFormatError } from "./auth/password";
export { decideLogin, ENV_ADMIN_SUBJECT } from "./auth/loginPolicy";
export type { LoginOutcome, LoginPolicyInput, LoginUser } from "./auth/loginPolicy";
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

// --- AI Manager -----------------------------------------------------------
export type {
  Conversation,
  ConversationMessage,
  MessageRole,
  ToolCallRecord,
  AgentInstruction,
  InstructionScope,
  InstructionStatus,
  InstructionEffect,
  ScoreCondition,
  ManagerAction,
  ActionRisk,
  ActionStatus,
  Report,
  ReportType,
  ReportMetrics,
  PeriodComparison,
  ScheduledTask,
  ScheduledTaskKind,
  ConversationsRepository,
  InstructionsRepository,
  ManagerActionsRepository,
  ReportsRepository,
  ScheduledTasksRepository,
} from "./manager/types";

export { AiManager } from "./manager/aiManager";
export type { AiManagerDeps, TurnResult } from "./manager/aiManager";

export {
  RuleBasedManagerBrain,
  ClaudeManagerBrain,
  selectBrain,
  buildSystemPrompt,
  toolsForApi,
  resetAcknowledgements,
  numbersAreGrounded,
} from "./manager/brain";
export type { ManagerBrain, BrainPlan, BrainRequest, BrainDescription, AnthropicTransport, AnthropicResponse, NarrationRequest } from "./manager/brain";

export { MANAGER_TOOLS, findTool, requiresApproval, resolveAgentId } from "./manager/tools";
export type { ManagerTool, ToolContext, ToolResult } from "./manager/tools";

export {
  parseInstructionEffect,
  describeEffect,
  activeInstructionsFor,
  effectsOf,
  applyDiscoveryInstructions,
  scoreAdjustmentsFor,
  minScoreThreshold,
} from "./manager/instructionEffects";

export { computeMetrics, writeSummary, generateReport } from "./manager/reporting";

export {
  parsePeriod,
  parseSchedule,
  nextRunAt,
  withinPeriod,
  previousPeriodOf,
  dayPeriod,
  rollingWeek,
  today,
  yesterday,
} from "./manager/periods";
export type { Period } from "./manager/periods";

export { looksLikeChain, CHAIN_NAME_PATTERNS } from "./mockData/fakeBusinessNames";
export { applyQualifierInstructions } from "./prospectingManager";

export { leadsToCsv, csvField, csvRow, csvFilename, CSV_BOM } from "./export/leadsCsv";
export type { LeadsCsvOptions } from "./export/leadsCsv";

export { LEAD_PRESETS, findLeadPreset } from "./leadPresets";
export type { LeadPreset } from "./leadPresets";

export { observationToLead, normalizePhone, realWebsite, OVERTURE_SOURCE, OVERTURE_STAGES } from "./providers/overturePlaces";
export type { OvertureObservation, ObservationContext } from "./providers/overturePlaces";

export { HttpSiteFetcher, StubSiteFetcher, isFetchableUrl, USER_AGENT, MAX_BYTES, TIMEOUT_MS } from "./enrichment/siteFetcher";
export type { SiteFetcher, FetchedPage } from "./enrichment/siteFetcher";
export { analyzeSite, assessQuality, extractAnchors, needsWebsiteAnalysis } from "./enrichment/websiteAnalyzer";
export type { SiteAnalysis } from "./enrichment/websiteAnalyzer";

export { checkWebsite, checkWebsites, resolveBatchSize } from "./workers/websiteCheckWorker";
export type { WebsiteCheckResult } from "./workers/websiteCheckWorker";

// --- Communications Centre (a Manager tool, not an agent) -------------------
export { CommsService, approvalFingerprint } from "./comms/commsService";
export type { CommsDeps, DraftInput, SendOutcome } from "./comms/commsService";
export {
  ResendEmailProvider,
  TwilioSmsProvider,
  RecordingEmailProvider,
  RecordingSmsProvider,
} from "./comms/providers";
export type { HttpTransport } from "./comms/providers";
export { ContactResolver, describeCandidate } from "./comms/contactResolver";
export type { ContactResolverDeps } from "./comms/contactResolver";
export type {
  Communication,
  CommunicationChannel,
  CommunicationDirection,
  CommunicationStatus,
  CommunicationFilter,
  CommunicationsRepository,
  EmailProvider,
  SmsProvider,
  ProviderReadiness,
  SendResult,
  ContactCandidate,
  ContactResolution,
} from "./comms/types";

export { PipedriveReader } from "./crm/pipedriveReader";
export type {
  PipedrivePerson,
  PipedriveOrganization,
  PipedriveDeal,
  PipedriveActivity,
  PipedriveNote,
  PipedriveTransport,
  PipedriveReaderOptions,
} from "./crm/pipedriveReader";
export { COMMS_TOOLS } from "./manager/commsTools";
export { composeMessage, composeFallback } from "./comms/composer";
export type { MessageComposer, ComposeRequest, ComposedMessage } from "./comms/composer";
