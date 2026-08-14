import type { CrmRecord, CrmRepository, Lead, PipelineStage } from "../types";

/**
 * SEAM for a future third-party CRM (HubSpot, GoHighLevel, Salesforce...).
 * This internal system is NOT meant to replace a CRM — pushLead/updateStage
 * model handing a qualified lead off to one. A real adapter implements this
 * same interface; the ProspectingManager and dashboard never need to change.
 */
export interface CrmAdapter {
  readonly crmName: string;
  pushLead(lead: Lead): Promise<CrmRecord>;
  updateStage(leadId: string, stage: PipelineStage): Promise<CrmRecord>;
  getRecords(leadId: string): Promise<CrmRecord[]>;
}

let recordCounter = 0;
function nextId(prefix: string): string {
  recordCounter += 1;
  return `${prefix}_${Date.now()}_${recordCounter}`;
}

/**
 * Writes to a local `mock_crm_records` table so the dashboard can preview
 * what a future CRM hand-off would look like. No external network calls.
 */
export class MockCrmAdapter implements CrmAdapter {
  readonly crmName = "mock-crm";

  constructor(private readonly repo: CrmRepository) {}

  async pushLead(lead: Lead): Promise<CrmRecord> {
    return this.repo.upsert({
      id: nextId("crm"),
      leadId: lead.id,
      stage: "CRM",
      syncedAt: new Date().toISOString(),
      externalCrmName: this.crmName,
    });
  }

  async updateStage(leadId: string, stage: PipelineStage): Promise<CrmRecord> {
    return this.repo.upsert({
      id: nextId("crm"),
      leadId,
      stage,
      syncedAt: new Date().toISOString(),
      externalCrmName: this.crmName,
    });
  }

  async getRecords(leadId: string): Promise<CrmRecord[]> {
    return this.repo.listByLead(leadId);
  }
}
