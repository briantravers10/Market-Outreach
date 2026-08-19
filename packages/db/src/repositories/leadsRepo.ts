import type Database from "better-sqlite3";
import type { Lead, LeadFilter, LeadsRepository } from "@market-outreach/core";

interface LeadRow {
  id: string;
  business_name: string;
  industry: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  website_status: string;
  website_quality: string;
  online_booking_status: string;
  booking_provider: string | null;
  booking_method: string;
  staff_count: number | null;
  staff_count_confidence: string;
  rating: number | null;
  review_count: number | null;
  instagram: string | null;
  facebook: string | null;
  social_activity: string;
  location_count: number | null;
  services: string;
  prospect_score: number | null;
  score_breakdown: string;
  score_reason: string | null;
  data_confidence: string;
  discovery_source: string;
  date_discovered: string;
  date_last_researched: string | null;
  research_status: string;
  qualification_status: string;
  pipeline_stage: string;
  campaign_id: string;
  job_id: string;
  is_duplicate_of: string | null;
  stages_completed: string;
  service_area: string | null;
  location_confidence: string;
  location_evidence: string;
  notes: string;
}

function rowToLead(row: LeadRow): Lead {
  return {
    id: row.id,
    businessName: row.business_name,
    industry: row.industry,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    phone: row.phone,
    email: row.email,
    website: row.website,
    websiteStatus: row.website_status as Lead["websiteStatus"],
    websiteQuality: row.website_quality as Lead["websiteQuality"],
    onlineBookingStatus: row.online_booking_status as Lead["onlineBookingStatus"],
    bookingProvider: row.booking_provider,
    bookingMethod: row.booking_method as Lead["bookingMethod"],
    staffCount: row.staff_count,
    staffCountConfidence: row.staff_count_confidence as Lead["staffCountConfidence"],
    rating: row.rating,
    reviewCount: row.review_count,
    instagram: row.instagram,
    facebook: row.facebook,
    socialActivity: row.social_activity as Lead["socialActivity"],
    locationCount: row.location_count,
    services: JSON.parse(row.services),
    prospectScore: row.prospect_score,
    scoreBreakdown: JSON.parse(row.score_breakdown),
    scoreReason: row.score_reason,
    dataConfidence: row.data_confidence as Lead["dataConfidence"],
    discoverySource: row.discovery_source,
    dateDiscovered: row.date_discovered,
    dateLastResearched: row.date_last_researched,
    researchStatus: row.research_status as Lead["researchStatus"],
    qualificationStatus: row.qualification_status as Lead["qualificationStatus"],
    pipelineStage: row.pipeline_stage as Lead["pipelineStage"],
    campaignId: row.campaign_id,
    jobId: row.job_id,
    isDuplicateOf: row.is_duplicate_of,
    stagesCompleted: JSON.parse(row.stages_completed) as Lead["stagesCompleted"],
    serviceArea: row.service_area,
    locationConfidence: row.location_confidence as Lead["locationConfidence"],
    locationEvidence: JSON.parse(row.location_evidence) as string[],
    notes: row.notes,
  };
}

export class SqliteLeadsRepository implements LeadsRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(lead: Lead): Lead {
    this.db
      .prepare(
        `INSERT INTO leads (
          id, business_name, industry, address, city, state, zip, phone, email, website,
          website_status, website_quality, online_booking_status, booking_provider, booking_method,
          staff_count, staff_count_confidence, rating, review_count, instagram, facebook,
          social_activity, location_count, services, prospect_score, score_breakdown, score_reason,
          data_confidence, discovery_source, date_discovered, date_last_researched, research_status,
          qualification_status, pipeline_stage, campaign_id, job_id, is_duplicate_of, stages_completed,
          service_area, location_confidence, location_evidence, notes
        ) VALUES (
          @id, @businessName, @industry, @address, @city, @state, @zip, @phone, @email, @website,
          @websiteStatus, @websiteQuality, @onlineBookingStatus, @bookingProvider, @bookingMethod,
          @staffCount, @staffCountConfidence, @rating, @reviewCount, @instagram, @facebook,
          @socialActivity, @locationCount, @services, @prospectScore, @scoreBreakdown, @scoreReason,
          @dataConfidence, @discoverySource, @dateDiscovered, @dateLastResearched, @researchStatus,
          @qualificationStatus, @pipelineStage, @campaignId, @jobId, @isDuplicateOf, @stagesCompleted,
          @serviceArea, @locationConfidence, @locationEvidence, @notes
        )
        ON CONFLICT(id) DO UPDATE SET
          phone=excluded.phone, email=excluded.email, website=excluded.website,
          website_status=excluded.website_status, website_quality=excluded.website_quality,
          online_booking_status=excluded.online_booking_status, booking_provider=excluded.booking_provider,
          booking_method=excluded.booking_method, staff_count=excluded.staff_count,
          staff_count_confidence=excluded.staff_count_confidence, rating=excluded.rating,
          review_count=excluded.review_count, instagram=excluded.instagram, facebook=excluded.facebook,
          social_activity=excluded.social_activity, location_count=excluded.location_count,
          services=excluded.services, prospect_score=excluded.prospect_score,
          score_breakdown=excluded.score_breakdown, score_reason=excluded.score_reason,
          data_confidence=excluded.data_confidence, date_last_researched=excluded.date_last_researched,
          research_status=excluded.research_status, qualification_status=excluded.qualification_status,
          pipeline_stage=excluded.pipeline_stage, is_duplicate_of=excluded.is_duplicate_of,
          stages_completed=excluded.stages_completed, service_area=excluded.service_area,
          location_confidence=excluded.location_confidence, location_evidence=excluded.location_evidence,
          notes=excluded.notes`
      )
      .run({
        ...lead,
        services: JSON.stringify(lead.services),
        scoreBreakdown: JSON.stringify(lead.scoreBreakdown),
        stagesCompleted: JSON.stringify(lead.stagesCompleted),
        serviceArea: lead.serviceArea,
        locationConfidence: lead.locationConfidence,
        locationEvidence: JSON.stringify(lead.locationEvidence),
      });
    return lead;
  }

  getById(id: string): Lead | null {
    const row = this.db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as LeadRow | undefined;
    return row ? rowToLead(row) : null;
  }

  list(filter: LeadFilter = {}): Lead[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.city) { clauses.push("city = @city"); params.city = filter.city; }
    if (filter.industry) { clauses.push("industry = @industry"); params.industry = filter.industry; }
    if (filter.minScore !== undefined) { clauses.push("prospect_score >= @minScore"); params.minScore = filter.minScore; }
    if (filter.maxScore !== undefined) { clauses.push("prospect_score <= @maxScore"); params.maxScore = filter.maxScore; }
    if (filter.websiteStatus) { clauses.push("website_status = @websiteStatus"); params.websiteStatus = filter.websiteStatus; }
    if (filter.onlineBookingStatus) { clauses.push("online_booking_status = @onlineBookingStatus"); params.onlineBookingStatus = filter.onlineBookingStatus; }
    if (filter.bookingProvider) { clauses.push("booking_provider = @bookingProvider"); params.bookingProvider = filter.bookingProvider; }
    if (filter.minStaffCount !== undefined) { clauses.push("staff_count >= @minStaffCount"); params.minStaffCount = filter.minStaffCount; }
    if (filter.minReviewCount !== undefined) { clauses.push("review_count >= @minReviewCount"); params.minReviewCount = filter.minReviewCount; }
    if (filter.dataConfidence) { clauses.push("data_confidence = @dataConfidence"); params.dataConfidence = filter.dataConfidence; }
    if (filter.researchStatus) { clauses.push("research_status = @researchStatus"); params.researchStatus = filter.researchStatus; }
    if (filter.qualificationStatus) { clauses.push("qualification_status = @qualificationStatus"); params.qualificationStatus = filter.qualificationStatus; }
    if (filter.campaignId) { clauses.push("campaign_id = @campaignId"); params.campaignId = filter.campaignId; }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM leads ${where} ORDER BY date_discovered DESC`).all(params) as LeadRow[];
    return rows.map(rowToLead);
  }

  findPossibleDuplicates(lead: Pick<Lead, "businessName" | "address" | "phone" | "city">): Lead[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM leads WHERE city = @city AND (business_name = @businessName OR (phone IS NOT NULL AND phone = @phone))`
      )
      .all({ city: lead.city, businessName: lead.businessName, phone: lead.phone }) as LeadRow[];
    return rows.map(rowToLead);
  }
}
