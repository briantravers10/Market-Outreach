import fs from "node:fs";
import path from "node:path";

/**
 * Finds the repo root by walking up from a starting directory looking for
 * `config/territories.json`. This is deliberately filesystem-search based
 * (rather than a fixed relative `../../..`) because this module is loaded
 * both by tsx scripts (where __dirname is the real source path) and by the
 * Next.js dashboard (where bundler __dirname rewriting is unreliable).
 */
function findRepoRoot(): string {
  const candidates = [__dirname, process.cwd()];
  for (const start of candidates) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, "config", "territories.json"))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    `Could not locate repo root (config/territories.json) starting from __dirname=${__dirname} or cwd=${process.cwd()}`
  );
}

function readJson<T>(relativePath: string): T {
  const root = findRepoRoot();
  const full = path.join(root, relativePath);
  return JSON.parse(fs.readFileSync(full, "utf-8")) as T;
}

/**
 * A unit of sales territory.
 *
 * `city` holds the territory's name, which is not always a city: at national
 * scale there are tens of thousands of towns and maintaining a config row per
 * town is not a plan. A territory is therefore whatever granularity you are
 * actually working at — usually a whole state — and `scope` says which, so the
 * name can be read honestly. The real city and ZIP of each business live on the
 * lead, where they came from the data rather than from a list someone typed.
 */
export interface Territory {
  id: string;
  city: string;
  state: string;
  scope?: TerritoryScope;
  /** IANA zone, e.g. "America/New_York". Needed before any call-window rules can be enforced. */
  timezone?: string;
  active: boolean;
}

export type TerritoryScope = "city" | "metro" | "state";

/**
 * How a business in this industry relates to a physical location.
 * `premises` — fixed address, findable on a map.
 * `mobile`   — travels to the client; a street address usually doesn't exist
 *              and a service area has to be inferred from weaker signals.
 * `hybrid`   — may rent a chair/suite or travel, so treat address as optional.
 */
export type LocationModel = "premises" | "mobile" | "hybrid";

/** Where this industry is realistically discoverable. See agents/scout.md. */
export type DiscoveryChannel = "maps" | "social-first";

export interface Industry {
  id: string;
  label: string;
  active: boolean;
  locationModel?: LocationModel;
  discoveryChannel?: DiscoveryChannel;
}

export function getLocationModel(industryId: string): LocationModel {
  return getIndustries().find((i) => i.id === industryId)?.locationModel ?? "premises";
}

export interface ScoringFactorConfig {
  id: string;
  label: string;
  category: string;
  points: number;
  enabled: boolean;
  appliesWhen: string;
  params?: Record<string, number>;
}

export interface ScoringConfig {
  version: number;
  description: string;
  baseScore: number;
  scoreRange: { min: number; max: number };
  factors: ScoringFactorConfig[];
  confidence: {
    description: string;
    keyFields: string[];
    thresholds: { high: number; medium: number };
  };
  qualification: {
    description: string;
    highPriorityMin: number;
    qualifiedMin: number;
    disqualifiedMax: number;
  };
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  description: string;
  permittedActions: string[];
  prohibitedActions: string[];
  disabled: boolean;
}

/** One Lead field mapped onto a Pipedrive custom field. */
export interface PipedriveCustomFieldMap {
  leadField: string;
  label: string;
  type: string;
  /** Pipedrive's 40-char hash key. Null until the field exists in a real account. */
  customFieldKey: string | null;
}

export interface PipedriveStandardFieldMap {
  leadField: string;
  pipedriveField: string;
  required: boolean;
}

export interface PipedriveConfig {
  description: string;
  connection: {
    apiBaseUrl: string;
    companyDomain: string | null;
    apiTokenEnvVar: string;
    liveSyncEnvVar: string;
    notes: string;
  };
  organization: {
    objectLabel: string;
    nameFrom: string;
    addressFrom: string;
    standardFields: PipedriveStandardFieldMap[];
    customFields: PipedriveCustomFieldMap[];
  };
  person: {
    objectLabel: string;
    createWhen: string;
    nameTemplate: string;
    standardFields: PipedriveStandardFieldMap[];
  };
  deal: {
    objectLabel: string;
    createWhen: string;
    titleTemplate: string;
    pipelineId: number | null;
    currency: string;
    valueFrom: string | null;
    valueNote: string;
    stageMap: Record<string, number | null>;
    stageMapNote: string;
  };
}

export interface LinkPlatform {
  domain: string;
  name: string;
  tier?: "integrated" | "third_party";
}

export interface LinkSignalsConfig {
  description: string;
  linkInBioHosts: LinkPlatform[];
  booking: { note: string; platforms: Array<LinkPlatform & { tier: "integrated" | "third_party" }> };
  payment: { note: string; platforms: LinkPlatform[] };
  social: { platforms: LinkPlatform[] };
  contact: { note: string; platforms: LinkPlatform[] };
  review: { platforms: LinkPlatform[] };
}

let linkSignalsCache: LinkSignalsConfig | null = null;
let territoriesCache: Territory[] | null = null;
let industriesCache: Industry[] | null = null;
let scoringConfigCache: ScoringConfig | null = null;
let agentsCache: AgentConfig[] | null = null;
let pipedriveConfigCache: PipedriveConfig | null = null;

export function getTerritories(): Territory[] {
  if (!territoriesCache) {
    territoriesCache = readJson<{ territories: Territory[] }>("config/territories.json").territories;
  }
  return territoriesCache;
}

export function getIndustries(): Industry[] {
  if (!industriesCache) {
    industriesCache = readJson<{ industries: Industry[] }>("config/industries.json").industries;
  }
  return industriesCache;
}

import type { ListingConfig } from "./enrichment/directoryIndex";

let bookingDirectoriesCache: BookingDirectoriesConfig | null = null;

export interface BookingDirectoriesConfig {
  description: string;
  verificationNote: string;
  matching: { minimumNameSimilarity: number; requireCityMatch: boolean; notes: string };
  platforms: {
    id: string;
    label: string;
    domain: string;
    /** Dead: these platforms have no per-business search URL. Kept only so the paid-search fallback keeps its shape. */
    searchUrlTemplate: string;
    profilePathPattern: string;
    enabled: boolean;
    /** Whether absence here counts toward "no online booking". Unproven platforms are crawled but not required. */
    requiredForNone?: boolean;
    /** How this platform's town directory is addressed. Absent means it cannot be crawled. */
    listing?: ListingConfig;
  }[];
}

/** Booking platforms to look a business up on when their own site cannot answer. */
export function getBookingDirectories(): BookingDirectoriesConfig {
  if (!bookingDirectoriesCache) {
    bookingDirectoriesCache = readJson<BookingDirectoriesConfig>("config/booking-directories.json");
  }
  return bookingDirectoriesCache;
}

export function getScoringConfig(): ScoringConfig {
  if (!scoringConfigCache) {
    scoringConfigCache = readJson<ScoringConfig>("config/scoring-config.json");
  }
  return scoringConfigCache;
}

export function getAgentConfigs(): AgentConfig[] {
  if (!agentsCache) {
    agentsCache = readJson<{ agents: AgentConfig[] }>("config/agents.json").agents;
  }
  return agentsCache;
}

export function getLinkSignals(): LinkSignalsConfig {
  if (!linkSignalsCache) {
    linkSignalsCache = readJson<LinkSignalsConfig>("config/link-signals.json");
  }
  return linkSignalsCache;
}

export function getPipedriveConfig(): PipedriveConfig {
  if (!pipedriveConfigCache) {
    pipedriveConfigCache = readJson<PipedriveConfig>("config/crm-pipedrive.json");
  }
  return pipedriveConfigCache;
}

/** Clears in-memory config caches — mainly useful for tests or hot-reload tooling. */
export function clearConfigCache(): void {
  territoriesCache = null;
  industriesCache = null;
  scoringConfigCache = null;
  agentsCache = null;
  pipedriveConfigCache = null;
  linkSignalsCache = null;
}

export function getDiscoveryChannel(industryId: string): DiscoveryChannel {
  return getIndustries().find((i) => i.id === industryId)?.discoveryChannel ?? "maps";
}
