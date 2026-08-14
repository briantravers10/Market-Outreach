import type { Lead, OutreachAttempt, OutreachChannel, OutreachRepository } from "../types";

/**
 * OUTREACH IS DISABLED IN THIS PHASE.
 *
 * This file intentionally contains NO Resend/Twilio SDK usage and makes NO
 * network calls. It exists only to reserve the architectural seam for a
 * future outreach phase — the interface a real implementation would need to
 * satisfy is defined here, but every method is a safe no-op that logs the
 * attempt and returns status "DISABLED".
 *
 * DO NOT wire a real email/SMS provider into this file without explicit,
 * separate authorization — sending outreach is out of scope for the
 * prospecting-system skeleton.
 */
export interface OutreachService {
  readonly status: "DISABLED";
  requestEmail(lead: Lead, note: string): Promise<OutreachAttempt>;
  requestSms(lead: Lead, note: string): Promise<OutreachAttempt>;
}

let attemptCounter = 0;
function nextId(): string {
  attemptCounter += 1;
  return `outreach_${Date.now()}_${attemptCounter}`;
}

export class DisabledOutreachService implements OutreachService {
  readonly status = "DISABLED" as const;

  constructor(private readonly repo: OutreachRepository) {}

  async requestEmail(lead: Lead, note: string): Promise<OutreachAttempt> {
    return this.logDisabledAttempt(lead, "email", note);
  }

  async requestSms(lead: Lead, note: string): Promise<OutreachAttempt> {
    return this.logDisabledAttempt(lead, "sms", note);
  }

  private async logDisabledAttempt(lead: Lead, channel: OutreachChannel, note: string): Promise<OutreachAttempt> {
    return this.repo.logAttempt({
      id: nextId(),
      leadId: lead.id,
      channel,
      status: "DISABLED",
      requestedAt: new Date().toISOString(),
      note: `Outreach disabled (skeleton phase). ${note}`,
    });
  }
}
