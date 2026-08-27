import type { SqlClient } from "../sqlClient";
import type {
  Lead,
  LeadFilter,
  LeadGroupColumn,
  LeadGroupCount,
  LeadSummaryStats,
  LeadsRepository,
} from "@market-outreach/core";

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
  website_checked_at: string | null;
  analysis_version: number | null;
  directory_checked_at: string | null;
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
    websiteCheckedAt: row.website_checked_at,
    analysisVersion: row.analysis_version ?? null,
    directoryCheckedAt: row.directory_checked_at ?? null,
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
  "data_confidence", "discovery_source", "external_id", "source_confidence", "latitude", "longitude", "website_checked_at", "analysis_version", "directory_checked_at",
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
    website_checked_at: lead.websiteCheckedAt,
    analysis_version: lead.analysisVersion,
    directory_checked_at: lead.directoryCheckedAt,
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
  if (filter.discoveredSince) {
    clauses.push("date_discovered >= @discoveredSince");
    params.discoveredSince = filter.discoveredSince;
  }
  if (filter.discoveredBefore) {
    clauses.push("date_discovered < @discoveredBefore");
    params.discoveredBefore = filter.discoveredBefore;
  }
  if (filter.nameContains) {
    clauses.push("LOWER(business_name) LIKE @nameContains");
    params.nameContains = `%${filter.nameContains.toLowerCase()}%`;
  }
  if (filter.isDuplicate !== undefined) {
    clauses.push(filter.isDuplicate ? "is_duplicate_of IS NOT NULL" : "is_duplicate_of IS NULL");
  }
  if (filter.hasStage) {
    clauses.push("stages_completed LIKE @stagePattern");
    params.stagePattern = `%"${filter.hasStage}"%`;
  }
  if (filter.awaitingWebsiteCheck) {
    clauses.push("website IS NOT NULL AND website_checked_at IS NULL AND online_booking_status = 'UNKNOWN'");
  }
  if (filter.unreachableCheckedBefore) {
    clauses.push("website IS NOT NULL AND website_status = 'UNREACHABLE' AND website_checked_at < @unreachableBefore");
    params.unreachableBefore = filter.unreachableCheckedBefore;
  }
  if (filter.readyForReview) {
    const { ready, analysisVersion } = filter.readyForReview;
    // Ready means: not a duplicate, the booking question is answered, and it
    // was answered by the current method. Anything else is still being worked
    // on and must not reach a call list.
    const readyClause =
      "(is_duplicate_of IS NULL AND online_booking_status <> 'UNKNOWN' AND analysis_version >= @readyVersion)";
    clauses.push(ready ? readyClause : `NOT ${readyClause}`);
    params.readyVersion = analysisVersion;
  }
  if (filter.hasBookingProvider !== undefined) {
    // Keyed on the booking STATUS rather than on bookingProvider being
    // non-null: a business can be found booking through a tool we did not
    // recognise, and that is still a business that books online.
    clauses.push(
      filter.hasBookingProvider
        ? "online_booking_status IN ('THIRD_PARTY_BOOKING_SYSTEM', 'INTEGRATED_BOOKING_SYSTEM')"
        : "online_booking_status = 'NONE'"
    );
  }
  if (filter.heldReason) {
    // These mirror assessReadiness() in the same order it checks them, and the
    // order is what makes the buckets exclusive: a duplicate is only counted as
    // a duplicate, never also as booking-unknown. Together with readyForReview
    // they partition the table, so the breakdown adds up to the total — a
    // breakdown that does not add up implies leads are somewhere nobody looks.
    const version = filter.heldReason.analysisVersion;
    params.heldVersion = version;
    switch (filter.heldReason.reason) {
      case "duplicate":
        clauses.push("is_duplicate_of IS NOT NULL");
        break;
      case "never-researched":
        clauses.push("is_duplicate_of IS NULL AND website IS NOT NULL AND website_checked_at IS NULL");
        break;
      case "booking-unknown-after-read":
        clauses.push(
          `is_duplicate_of IS NULL AND online_booking_status = 'UNKNOWN'
           AND website IS NOT NULL AND website_checked_at IS NOT NULL`
        );
        break;
      case "booking-unknown-no-website":
        clauses.push("is_duplicate_of IS NULL AND online_booking_status = 'UNKNOWN' AND website IS NULL");
        break;
      case "stale-method":
        clauses.push(
          `is_duplicate_of IS NULL AND online_booking_status <> 'UNKNOWN'
           AND COALESCE(analysis_version, 0) < @heldVersion`
        );
        break;
    }
  }
  if (filter.awaitingDirectoryLookup) {
    // Still unanswered, and the Website Analyst has already had its turn —
    // either it read the site and found nothing conclusive, or there is no
    // site to read, which is the case the directories exist for.
    //
    // Duplicates are excluded because a duplicate never reaches the call list
    // whatever the answer is, and paid lookups should not be spent on one.
    clauses.push(
      `online_booking_status = 'UNKNOWN' AND is_duplicate_of IS NULL
       AND (website IS NULL OR website_checked_at IS NOT NULL)
       AND (directory_checked_at IS NULL OR directory_checked_at < @directoryBefore)`
    );
    params.directoryBefore = filter.awaitingDirectoryLookup;
  }
  if (filter.needsWebsiteRecheck) {
    clauses.push(
      `website IS NOT NULL AND website_checked_at IS NOT NULL AND website_checked_at < @recheckBefore
       AND (website_status = 'UNREACHABLE'
            OR online_booking_status = 'NONE'
            OR (website_status = 'EXISTS' AND online_booking_status = 'UNKNOWN'))`
    );
    params.recheckBefore = filter.needsWebsiteRecheck;
  }

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export class SqliteLeadsRepository implements LeadsRepository {
  constructor(private readonly db: SqlClient) {}

  /**
   * Write one lead.
   *
   * Delegates to the bulk path rather than carrying its own hand-written SQL.
   * The two used to be separate statements, and they had already drifted: the
   * single-lead version never updated analysis_version, so a lead written one
   * at a time kept whatever research-method stamp it arrived with and could
   * sit in the holding area forever. Generating both from LEAD_COLUMNS is the
   * only way that class of bug stays fixed.
   */
  async upsert(lead: Lead): Promise<Lead> {
    await this.upsertMany([lead]);
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


  /**
   * The set of columns this will group by, as a lookup rather than a check.
   *
   * The column name is interpolated into the statement — it cannot be bound as
   * a parameter — so it must never come from a caller unchecked. Matching
   * against a fixed map means an unexpected value throws instead of reaching
   * SQL.
   */
  private static readonly GROUPABLE: Record<LeadGroupColumn, string> = {
    city: "city",
    state: "state",
    industry: "industry",
    campaign_id: "campaign_id",
    website_status: "website_status",
    website_quality: "website_quality",
    online_booking_status: "online_booking_status",
    booking_provider: "booking_provider",
    booking_method: "booking_method",
    data_confidence: "data_confidence",
    qualification_status: "qualification_status",
    research_status: "research_status",
    stages_completed: "stages_completed",
  };

  async groupCount(column: LeadGroupColumn, filter: LeadFilter = {}): Promise<LeadGroupCount[]> {
    const safeColumn = SqliteLeadsRepository.GROUPABLE[column];
    if (!safeColumn) throw new Error(`Not a groupable column: ${column}`);
    const { where, params } = buildWhere(filter);
    const rows = (await this.db
      .prepare(
        `SELECT ${safeColumn} AS value, COUNT(*) AS n FROM leads ${where}
         GROUP BY ${safeColumn} ORDER BY n DESC`
      )
      .all(params)) as { value: string | null; n: number | string }[];
    return rows.map((row) => ({ value: row.value, count: Number(row.n) }));
  }

  async summaryStats(filter: LeadFilter = {}): Promise<LeadSummaryStats> {
    const { where, params } = buildWhere(filter);
    // One round trip rather than nine. COUNT(expr) counts non-null results, so
    // a CASE returning NULL is how each conditional count is expressed in a
    // form both SQLite and Postgres accept — FILTER is Postgres-only.
    const row = (await this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COUNT(prospect_score) AS scored,
           COUNT(CASE WHEN research_status IN ('ANALYZED','SCORED','COMPLETE') THEN 1 END) AS researched,
           COUNT(CASE WHEN qualification_status IN ('QUALIFIED','HIGH_PRIORITY') THEN 1 END) AS qualified,
           COUNT(CASE WHEN qualification_status = 'HIGH_PRIORITY' THEN 1 END) AS high_priority,
           COUNT(CASE WHEN website_status = 'NONE' THEN 1 END) AS no_website,
           COUNT(phone) AS with_phone,
           COUNT(CASE WHEN online_booking_status = 'UNKNOWN' THEN 1 END) AS booking_unchecked,
           AVG(prospect_score) AS average_score
         FROM leads ${where}`
      )
      .get(params)) as Record<string, number | string | null> | undefined;

    const num = (key: string) => Number(row?.[key] ?? 0);
    const average = row?.average_score;
    return {
      total: num("total"),
      scored: num("scored"),
      researched: num("researched"),
      qualified: num("qualified"),
      highPriority: num("high_priority"),
      noWebsite: num("no_website"),
      withPhone: num("with_phone"),
      bookingUnchecked: num("booking_unchecked"),
      averageScore: average === null || average === undefined ? null : Math.round(Number(average)),
    };
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
    // The tiebreak is `id`, not `business_name`, and that is load-bearing.
    // Scores tie heavily — every lead awaiting a website check currently scores
    // exactly 25 — so a tiebreak the index does not carry forces Postgres to
    // read and sort the whole matching set to find one page. Measured on the
    // live database: 2,391ms with the name tiebreak, 3.9ms with this one.
    // Ties come out in id order rather than alphabetically, which is stable,
    // which is what paging actually needs.
    //
    // "least-recently-checked" exists because ordering a re-check queue by
    // score is a trap. Leads stay in that queue after being processed — a site
    // that is still unreachable is still worth another go later — so sorting
    // by score hands the same top 800 back on every run, forever. That is not
    // hypothetical: it ran for about thirteen hours, re-reading the same 800
    // websites every five minutes while 39,000 leads behind them never moved.
    // Oldest-first is self-correcting: processing a lead stamps it and sends
    // it to the back.
    const order =
      filter.orderBy === "score"
        ? "prospect_score DESC NULLS LAST, id"
        : filter.orderBy === "name"
          ? "business_name ASC"
          : filter.orderBy === "least-recently-checked"
            ? "website_checked_at ASC NULLS FIRST, id"
            : filter.orderBy === "least-recently-looked-up"
              ? "directory_checked_at ASC NULLS FIRST, id"
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
