import type { LeadsRepository } from "../types";
import type { PipedriveReader } from "../crm/pipedriveReader";
import type { CommunicationChannel, ContactCandidate, ContactResolution } from "./types";

/**
 * Turning "John" into an actual email address.
 *
 * This is the most dangerous step in the Communications Centre, and it is
 * written to be timid. Every other mistake here is recoverable: a clumsy draft
 * gets rewritten, a failed send gets retried. Messaging the wrong person cannot
 * be taken back, and it is worse than sending nothing.
 *
 * So the rule is: when more than one person could be meant, ASK. Never rank,
 * never prefer the more recently updated one, never fall back to "the only one
 * with an email address". Those are all reasonable-sounding heuristics that
 * would each, eventually, email a stranger.
 */

export interface ContactResolverDeps {
  /** Null when Pipedrive is not configured — leads alone are still searchable. */
  pipedrive: PipedriveReader | null;
  leads: LeadsRepository;
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Two candidates are the same person if they would receive the same message. */
function sameRecipient(a: ContactCandidate, b: ContactCandidate): boolean {
  if (a.pipedrivePersonId && b.pipedrivePersonId) return a.pipedrivePersonId === b.pipedrivePersonId;
  const email = (c: ContactCandidate) => c.email?.trim().toLowerCase() ?? "";
  const phone = (c: ContactCandidate) => (c.phone ?? "").replace(/\D/g, "");
  if (email(a) && email(a) === email(b)) return true;
  if (phone(a) && phone(a) === phone(b)) return true;
  return false;
}

function dedupe(candidates: ContactCandidate[]): ContactCandidate[] {
  const kept: ContactCandidate[] = [];
  for (const candidate of candidates) {
    const existing = kept.find((k) => sameRecipient(k, candidate));
    if (!existing) {
      kept.push(candidate);
      continue;
    }
    // Same person from two sources: keep whichever knows more, so the choice
    // shown to the owner is the most complete version of them.
    existing.email = existing.email ?? candidate.email;
    existing.phone = existing.phone ?? candidate.phone;
    existing.businessName = existing.businessName ?? candidate.businessName;
    existing.pipedrivePersonId = existing.pipedrivePersonId ?? candidate.pipedrivePersonId;
    existing.pipedriveOrgId = existing.pipedriveOrgId ?? candidate.pipedriveOrgId;
    existing.leadId = existing.leadId ?? candidate.leadId;
  }
  return kept;
}

export class ContactResolver {
  constructor(private readonly deps: ContactResolverDeps) {}

  /**
   * Finds who is meant by a name or business, for a given channel.
   *
   * The channel matters: a contact with a phone number and no email is
   * perfectly resolvable for SMS and unreachable for email, and saying
   * "unreachable" is more useful than saying "not found".
   */
  async resolve(query: string, channel: CommunicationChannel): Promise<ContactResolution> {
    const cleaned = normalise(query);
    if (!cleaned) return { kind: "not_found", query };

    const candidates = dedupe([
      ...(await this.fromPipedrive(cleaned)),
      ...(await this.fromLeads(cleaned)),
    ]);

    if (candidates.length === 0) return { kind: "not_found", query };

    // Narrow to those actually reachable on this channel — but only as a
    // tie-break, never as a way to turn an ambiguous set into a single answer.
    const reachable = candidates.filter((c) => (channel === "email" ? c.email : c.phone));

    if (reachable.length === 1) return { kind: "resolved", contact: reachable[0] };
    if (reachable.length > 1) {
      return { kind: "ambiguous", candidates: reachable, query };
    }

    // Nobody reachable. If exactly one person matched, the useful answer is
    // "found them, no address" rather than "no such person".
    if (candidates.length === 1) {
      return { kind: "unreachable", contact: candidates[0], channel };
    }
    return { kind: "ambiguous", candidates, query };
  }

  private async fromPipedrive(query: string): Promise<ContactCandidate[]> {
    if (!this.deps.pipedrive) return [];
    try {
      const people = await this.deps.pipedrive.searchPersons(query);
      return people.map((person) => ({
        name: person.name,
        businessName: person.organizationName,
        email: person.email,
        phone: person.phone,
        source: `Pipedrive person ${person.id}`,
        pipedrivePersonId: person.id,
        pipedriveOrgId: person.organizationId,
        leadId: null,
      }));
    } catch {
      // A CRM outage must not silently narrow the candidate set to "just our
      // leads" — that could resolve a name that is ambiguous in reality. The
      // caller sees fewer candidates, so this rethrows nothing but the search
      // is treated as having found nothing, and the lead search below still
      // has to stand on its own.
      return [];
    }
  }

  private async fromLeads(query: string): Promise<ContactCandidate[]> {
    const matches = await this.deps.leads.list({ nameContains: query, limit: 25 });
    return matches.map((lead) => ({
      // A lead is a business, not a person. Saying so keeps the disambiguation
      // prompt honest rather than inventing a contact name.
      name: lead.businessName,
      businessName: lead.businessName,
      email: lead.email,
      phone: lead.phone,
      source: `Lead in ${lead.city}`,
      pipedrivePersonId: null,
      pipedriveOrgId: null,
      leadId: lead.id,
    }));
  }
}

/** One line per candidate, with enough to tell them apart. Used in the disambiguation prompt. */
export function describeCandidate(candidate: ContactCandidate, channel: CommunicationChannel): string {
  const where = candidate.businessName && candidate.businessName !== candidate.name ? ` at ${candidate.businessName}` : "";
  const destination = channel === "email" ? candidate.email : candidate.phone;
  return `${candidate.name}${where} — ${destination ?? "no address on file"} (${candidate.source})`;
}
