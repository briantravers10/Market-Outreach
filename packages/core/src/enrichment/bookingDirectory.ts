/**
 * Looking a business up on the booking platforms directly.
 *
 * This answers the question the whole score turns on for the leads their own
 * website cannot answer it for — the ones with no website at all, and the ones
 * whose site would not load. That is the great majority of the holding area.
 *
 * The asymmetry matters and shapes every decision below. A business FOUND on
 * Booksy is a WORSE prospect: they already have what we are selling. So:
 *
 *   false positive  — we wrongly think they book online, and a good lead is
 *                     quietly discarded. Invisible, and the worst outcome.
 *   false negative  — we wrongly think they do not, and a call is wasted.
 *                     Visible, annoying, recoverable.
 *
 * Both are bad, the first is worse, and the way to avoid it is to refuse to
 * match on weak evidence. Hence: strong name similarity AND a city match, or
 * no claim at all.
 */

import type { Lead } from "../types";
import { extractAnchors } from "./websiteAnalyzer";

export interface DirectoryPlatform {
  id: string;
  label: string;
  domain: string;
  searchUrlTemplate: string;
  profilePathPattern: string;
  enabled: boolean;
}

/** One candidate listing, however it was found. */
export interface DirectoryCandidate {
  /** The platform's own page for this business. */
  url: string;
  /** The business name as the platform has it. */
  name: string;
  /** Whatever location text came back, if any. */
  locationText: string | null;
}

export type DirectoryOutcome =
  /** Found them, confidently. They have online booking. */
  | { kind: "found"; platform: string; profileUrl: string; matchedName: string; similarity: number }
  /** Searched properly and they are not there. Real evidence of no booking on this platform. */
  | { kind: "not_listed"; platform: string }
  /**
   * Could not search. NOT the same as not_listed, and collapsing the two is
   * the single most damaging mistake available here — it would mark every
   * business as having no booking every time a platform blocked us, handing
   * out points nobody earned across the whole database.
   */
  | { kind: "unavailable"; platform: string; reason: string };

export interface DirectoryLookup {
  readonly name: string;
  /** Whether this lookup can run at all — credentials present, budget left. */
  available(): boolean;
  search(lead: Lead, platform: DirectoryPlatform): Promise<DirectoryOutcome>;
}

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

/** Strips the noise that differs between a map dataset and a booking profile. */
export function normaliseName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // Apostrophes are DELETED, not spaced. Replacing them leaves "bella's" as
    // "bella s" — a stray one-letter token that fails to match "bellas", which
    // is the same business written the way half these datasets write it.
    .replace(/['’`]/g, "")
    // Trade suffixes and legal forms carry no identifying information and are
    // present in one dataset and absent in the other about half the time.
    .replace(/\b(llc|inc|ltd|co|corp|company|the|and|&)\b/g, " ")
    .replace(/\b(salon|spa|barbershop|barbers|studio|beauty|hair|nails|nail)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Similarity from 0 to 1, by token overlap weighted toward rarer words.
 *
 * Deliberately not edit distance: "Bella Hair Studio" and "Bella Nail Studio"
 * are one character apart by that measure and are different businesses, while
 * "Bella's" and "Bella" are further apart and are the same one. What actually
 * identifies a salon is its distinctive words, which is what this compares.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
      continue;
    }
    // A possessive or plural is the same word: "bellas" matches "bella".
    for (const other of rightTokens) {
      if (token.length > 3 && (other.startsWith(token) || token.startsWith(other))) {
        shared += 0.9;
        break;
      }
    }
  }

  // Divided by the SMALLER set, so a platform listing carrying extra words
  // ("Bella Studio — Downtown Tampa") still matches "Bella Studio". Dividing
  // by the union would punish the more descriptive listing for being helpful.
  return Math.min(1, shared / Math.min(leftTokens.size, rightTokens.size));
}

/** Whether the location text plausibly refers to the lead's city. */
export function cityMatches(lead: Pick<Lead, "city" | "state" | "zip">, locationText: string | null): boolean {
  if (!locationText) return false;
  const haystack = locationText.toLowerCase();
  if (lead.zip && haystack.includes(lead.zip)) return true;
  const city = lead.city.trim().toLowerCase();
  return city.length > 2 && haystack.includes(city);
}

export interface MatchOptions {
  minimumNameSimilarity: number;
  requireCityMatch: boolean;
}

/**
 * Picks the one candidate that is definitely this business, or none.
 *
 * Returns null on ambiguity rather than taking the best score. Two listings
 * both clearing the bar means the platform has near-duplicates and we cannot
 * tell which is theirs — and "probably this one" is exactly the reasoning that
 * discards a good lead.
 */
export function pickMatch(
  lead: Pick<Lead, "businessName" | "city" | "state" | "zip">,
  candidates: DirectoryCandidate[],
  options: MatchOptions
): { candidate: DirectoryCandidate; similarity: number } | null {
  const scored = candidates
    .map((candidate) => ({ candidate, similarity: nameSimilarity(lead.businessName, candidate.name) }))
    .filter((entry) => entry.similarity >= options.minimumNameSimilarity)
    .filter((entry) => !options.requireCityMatch || cityMatches(lead, entry.candidate.locationText));

  if (scored.length === 0) return null;
  if (scored.length === 1) return scored[0];

  // Several cleared the bar. Accept only if one is clearly ahead; a near-tie
  // is genuine ambiguity and gets no answer.
  scored.sort((a, b) => b.similarity - a.similarity);
  const [best, runnerUp] = scored;
  if (best.similarity - runnerUp.similarity >= 0.15) return best;
  return null;
}

/** The search terms for one business on one platform. */
export function buildSearchQuery(lead: Pick<Lead, "businessName" | "city" | "state">): string {
  return `${lead.businessName} ${lead.city} ${lead.state}`.replace(/\s+/g, " ").trim();
}

export function searchUrlFor(platform: DirectoryPlatform, query: string): string {
  return platform.searchUrlTemplate.replace("{query}", encodeURIComponent(query));
}

/**
 * Pulls candidate profile links out of a platform's search results page.
 *
 * Matches on the platform's own profile path shape rather than on classes or
 * element structure, because markup churns constantly and URL shapes are far
 * more stable — a redesign rarely changes what a profile URL looks like.
 *
 * The anchor text is the business name often enough to be worth using, and
 * where it is not, the name simply fails to match and no claim is made.
 */
export function extractCandidatesFromHtml(
  html: string,
  baseUrl: string,
  platform: DirectoryPlatform
): DirectoryCandidate[] {
  let pattern: RegExp;
  try {
    pattern = new RegExp(platform.profilePathPattern);
  } catch {
    // A bad pattern in config must not take the whole lookup down; the caller
    // sees no candidates and reports "unavailable" rather than "not listed".
    return [];
  }

  const seen = new Set<string>();
  const candidates: DirectoryCandidate[] = [];

  for (const anchor of extractAnchors(html, baseUrl)) {
    let url: URL;
    try {
      url = new URL(anchor.href);
    } catch {
      continue;
    }
    if (!url.hostname.endsWith(platform.domain)) continue;
    if (!pattern.test(url.pathname)) continue;
    if (seen.has(url.toString())) continue;

    const name = anchor.text.trim();
    if (!name) continue;

    seen.add(url.toString());
    candidates.push({
      url: url.toString(),
      name,
      // A results page rarely puts the address in the anchor, so the path is
      // used as a weak location hint — many platforms slug the city into it.
      locationText: `${name} ${decodeURIComponent(url.pathname).replace(/[-_/]/g, " ")}`,
    });

    if (candidates.length >= 30) break;
  }

  return candidates;
}
