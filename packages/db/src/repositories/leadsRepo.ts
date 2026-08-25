import type { SqlClient } from "../sqlClient";
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
  external_id: string | null;
  source_confidence: number | null;
  latitude: number | null;
  longitude: number | null;
  date_discovered: string;
  date_last_researched: string | null;
  research_status: string;
  qualification_status: string;
  pipeline_stage: string;
  campaign_id: string;
  job_id: string;
  is_duplicate_of: string | null;
  stages_completed: string;
  link_in_bio_url: string | null;
  detected_links: string;
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
    externalId: row.external_id,
    sourceConfidence: row.source_confidence,
    latitude: row.latitude,
    longitude: row.longitude,
    dateDiscovered: row.date_discovered,
    dateLastResearched: row.date_last_researched,
    researchStatus: row.research_status as Lead["researchStatus"],
    qualificationStatus: row.qualification_status as Lead["qualificationStatus"],
    pipelineStage: row.pipeline_stage as Lead["pipelineStage"],
    campaignId: row.campaign_id,
    jobId: row.job_id,
    isDuplicateOf: row.is_duplicate_of,
    stagesCompleted: JSON.parse(row.stages_completed) as Lead["stagesCompleted"],
    linkInBioUrl: row.link_in_bio_url,
    detectedLinks: JSON.parse(row.detected_links) as Lead["detectedLinks"],
    serviceArea: row.service_area,
    locationConfidence: row.location_confidence as Lead["locationConfidence"],
    locationEvidence: JSON.parse(row.location_evidence) as string[],
    notes: row.notes,
  };
}


/**
 * The physical column order, in one place.
 *
 * `upsert` and `upsertMany` both build statements from this, so adding a
 * column cannot leave one write path silently dropping it — which is exactly
 * the bug that would show up months later as "some leads have no latitude".
 */
const LEAD_COLUMNS = [
  "id", "business_name", "industry", "address", "city", "state", "zip", "phone", "email", "website",
  "website_status", "website_quality", "online_booking_status", "booking_provider", "booking_method",
  "staff_count", "staff_count_confidence", "rating", "review_count", "instagram", "facebook",
  "social_activity", "location_count", "services", "prospect_score", "score_breakdown", "score_reason",
  "data_confidence", "discovery_source", "external_id", "source_confidence", "latitude", "longitude",
  "date_discovered", "date_last_researched", "research_status", "qualification_status", "pipeline_stage",
  "campaign_id", "job_id", "is_duplicate_of", "stages_completed", "link_in_bio_url", "detected_links",
  "service_area", "location_confidence", "location_evidence", "notes",
] as const;

/** Everything except the identity and provenance of the original discovery. */
const UPDATABLE_COLUMNS = LEAD_COLUMNS.filter(
  (column) => !["id", "external_id", "discovery_source", "date_discovered", "campaign_id", "job_id"].includes(column)
);

function leadToRow(lead: Lead): Record<string, unknown> {
  return {
    id: lead.id,
    business_name: lead.businessName,
    industry: lead.industry,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    phone: lead.phone,
    email: lead.email,
    website: lead.website,
    website_status: lead.websiteStatus,
    website_quality: lead.websiteQuality,
    online_booking_status: lead.onlineBookingStatus,
    booking_provider: lead.bookingProvider,
    booking_method: lead.bookingMethod,
    staff_count: lead.staffCount,
    staff_count_confidence: lead.staffCountConfidence,
    rating: lead.rating,
    review_count: lead.reviewCount,
    instagram: lead.instagram,
    facebook: lead.facebook,
    social_activity: lead.socialActivity,
    location_count: lead.locationCount,
    services: JSON.stringify(lead.services),
    prospect_score: lead.prospectScore,
    score_breakdown: JSON.stringify(lead.scoreBreakdown),
    score_reason: lead.scoreReason,
    data_confidence: lead.dataConfidence,
    discovery_source: lead.discoverySource,
    external_id: lead.externalId,
    source_confidence: lead.sourceConfidence,
    latitude: lead.latitude,
    longitude: lead.longitude,
    date_discovered: lead.dateDiscovered,
    date_last_researched: lead.dateLastResearched,
    research_status: lead.researchStatus,
    qualification_status: lead.qualificationStatus,
    pipeline_stage: lead.pipelineStage,
    campaign_id: lead.campaignId,
    job_id: lead.jobId,
    is_duplicate_of: lead.isDuplicateOf,
    stages_completed: JSON.stringify(lead.stagesCompleted),
    link_in_bio_url: lead.linkInBioUrl,
    detected_links: JSON.stringify(lead.detectedLinks),
    service_area: lead.serviceArea,
    location_confidence: lead.locationConfidence,
    location_evidence: JSON.stringify(lead.locationEvidence),
    notes: lead.notes,
  };
}


/** The WHERE clause shared by list() and count(), so a filtered count can never disagree with the rows it counts. */
function buildWhere(filter: LeadFilter): { where: string; params: Record<string, unknown> } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.city) { clauses.push("city = @city"); params.city = filter.city; }
  if (filter.state) { clauses.push("state = @state"); params.state = filter.state; }
  if (filter.zip) { clauses.push("zip = @zip"); params.zip = filter.zip; }
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

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export class SqliteLeadsRepository implements LeadsRepository {
  constructor(private readonly db: SqlClient) {}

  async upsert(lead: Lead): Promise<Lead> {
    await this.db
      .prepare(
        `INSERT INTO leads (
          id, business_name, industry, address, city, state, zip, phone, email, website,
          website_status, website_quality, online_booking_status, booking_provider, booking_method,
          staff_count, staff_count_confidence, rating, review_count, instagram, facebook,
          social_activity, location_count, services, prospect_score, score_breakdown, score_reason,
          data_confidence, discovery_source, external_id, source_confidence, latitude, longitude,
          date_discovered, date_last_researched, research_status,
          qualification_status, pipeline_stage, campaign_id, job_id, is_duplicate_of, stages_completed,
          link_in_bio_url, detected_links, service_area, location_confidence, location_evidence, notes
        ) VALUES (
          @id, @businessName, @industry, @address, @city, @state, @zip, @phone, @email, @website,
          @websiteStatus, @websiteQuality, @onlineBookingStatus, @bookingProvider, @bookingMethod,
          @staffCount, @staffCountConfidence, @rating, @reviewCount, @instagram, @facebook,
          @socialActivity, @locationCount, @services, @prospectScore, @scoreBreakdown, @scoreReason,
          @dataConfidence, @discoverySource, @externalId, @sourceConfidence, @latitude, @longitude,
          @dateDiscovered, @dateLastResearched, @researchStatus,
          @qualificationStatus, @pipelineStage, @campaignId, @jobId, @isDuplicateOf, @stagesCompleted,
          @linkInBioUrl, @detectedLinks, @serviceArea, @locationConfidence, @locationEvidence, @notes
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
          data_confidence=excluded.data_confidence, source_confidence=excluded.source_confidence,
          latitude=excluded.latitude, longitude=excluded.longitude,
          date_last_researched=excluded.date_last_researched,
          research_status=excluded.research_status, qualification_status=excluded.qualification_status,
          pipeline_stage=excluded.pipeline_stage, is_duplicate_of=excluded.is_duplicate_of,
          stages_completed=excluded.stages_completed, link_in_bio_url=excluded.link_in_bio_url,
          detected_links=excluded.detected_links, service_area=excluded.service_area,
          location_confidence=excluded.location_confidence, location_evidence=excluded.location_evidence,
          notes=excluded.notes`
      )
      .run({
        ...lead,
        services: JSON.stringify(lead.services),
        scoreBreakdown: JSON.stringify(lead.scoreBreakdown),
        stagesCompleted: JSON.stringify(lead.stagesCompleted),
        linkInBioUrl: lead.linkInBioUrl,
        detectedLinks: JSON.stringify(lead.detectedLinks),
        serviceArea: lead.serviceArea,
        locationConfidence: lead.locationConfidence,
        locationEvidence: JSON.stringify(lead.locationEvidence),
      });
    return lead;
  }


  /**
   * Bulk upsert, chunked.
   *
   * Both backends limit how many bound parameters one statement may carry
   * (Postgres 65535, SQLite lower still), and this table is wide — so the
   * chunk size is derived from the column count rather than guessed, and stays
   * correct if a column is added later.
   */
  async upsertMany(leads: Lead[]): Promise<number> {
    if (leads.length === 0) return 0;
    const columns = LEAD_COLUMNS;
    const perChunk = Math.max(1, Math.floor(900 / columns.length));

    let written = 0;
    for (let start = 0; start < leads.length; start += perChunk) {
      const chunk = leads.slice(start, start + perChunk);
      const placeholders = chunk
        .map(() => `(${columns.map(() => "?").join(", ")})`)
        .join(", ");
      const values: unknown[] = [];
      for (const lead of chunk) {
        const row = leadToRow(lead);
        for (const column of columns) values.push(row[column]);
      }
      await this.db
        .prepare(
          `INSERT INTO leads (${columns.join(", ")}) VALUES ${placeholders}
           ON CONFLICT(id) DO UPDATE SET ${UPDATABLE_COLUMNS.map((c) => `${c}=excluded.${c}`).join(", ")}`
        )
        .run(...values);
      written += chunk.length;
    }
    return written;
  }


  async upsertManyByExternalId(leads: Lead[]): Promise<number> {
    if (leads.length === 0) return 0;
    const missing = leads.find((lead) => !lead.externalId);
    if (missing) {
      throw new Error(
        `upsertManyByExternalId requires an externalId on every lead; "${missing.businessName}" has none.`
      );
    }

    const columns = LEAD_COLUMNS;
    const perChunk = Math.max(1, Math.floor(900 / columns.length));
    // id is excluded from the update so a refreshed lead keeps the identity
    // anything else already refers to.
    const updatable = UPDATABLE_COLUMNS;

    let written = 0;
    for (let start = 0; start < leads.length; start += perChunk) {
      const chunk = leads.slice(start, start + perChunk);
      const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
      const values: unknown[] = [];
      for (const lead of chunk) {
        const row = leadToRow(lead);
        for (const column of columns) values.push(row[column]);
      }
      await this.db
        .prepare(
          `INSERT INTO leads (${columns.join(", ")}) VALUES ${placeholders}
           ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET ${updatable
             .map((c) => `${c}=excluded.${c}`)
             .join(", ")}`
        )
        .run(...values);
      written += chunk.length;
    }
    return written;
  }

  async count(filter: LeadFilter = {}): Promise<number> {
    const { where, params } = buildWhere(filter);
    const row = (await this.db
      .prepare(`SELECT COUNT(*) AS n FROM leads ${where}`)
      .get(params)) as { n: number | string } | undefined;
    return Number(row?.n ?? 0);
  }

  async getById(id: string): Promise<Lead | null> {
    const row = await this.db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as LeadRow | undefined;
    return row ? rowToLead(row) : null;
  }

  async list(filter: LeadFilter = {}): Promise<Lead[]> {
    const { where, params } = buildWhere(filter);

    // NULLS LAST on score: an unscored lead is not a zero-scoring lead, and
    // burying them under every scored one is wrong when you are checking an
    // import. Both dialects spell it the same way here.
    const order =
      filter.orderBy === "score"
        ? "prospect_score DESC NULLS LAST, business_name ASC"
        : filter.orderBy === "name"
          ? "business_name ASC"
          : "date_discovered DESC";
    // The limit is interpolated rather than bound because SQLite and Postgres
    // disagree about parameterising LIMIT; it is coerced to an integer first so
    // nothing from a query string can reach the statement.
    const limit = Number.isFinite(filter.limit) ? Math.max(0, Math.floor(filter.limit as number)) : null;
    const offset = Number.isFinite(filter.offset) ? Math.max(0, Math.floor(filter.offset as number)) : 0;
    const paging = limit === null ? "" : ` LIMIT ${limit} OFFSET ${offset}`;
    const rows = await this.db
      .prepare(`SELECT * FROM leads ${where} ORDER BY ${order}${paging}`)
      .all(params) as LeadRow[];
    return rows.map(rowToLead);
  }

  async findPossibleDuplicates(lead: Pick<Lead, "businessName" | "address" | "phone" | "city">): Promise<Lead[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM leads WHERE city = @city AND (business_name = @businessName OR (phone IS NOT NULL AND phone = @phone))`
      )
      .all({ city: lead.city, businessName: lead.businessName, phone: lead.phone }) as LeadRow[];
    return rows.map(rowToLead);
  }
}
