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

export interface Territory {
  id: string;
  city: string;
  state: string;
  active: boolean;
}

export interface Industry {
  id: string;
  label: string;
  active: boolean;
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

let territoriesCache: Territory[] | null = null;
let industriesCache: Industry[] | null = null;
let scoringConfigCache: ScoringConfig | null = null;

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

export function getScoringConfig(): ScoringConfig {
  if (!scoringConfigCache) {
    scoringConfigCache = readJson<ScoringConfig>("config/scoring-config.json");
  }
  return scoringConfigCache;
}

/** Clears in-memory config caches — mainly useful for tests or hot-reload tooling. */
export function clearConfigCache(): void {
  territoriesCache = null;
  industriesCache = null;
  scoringConfigCache = null;
}
