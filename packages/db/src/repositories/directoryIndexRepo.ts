import type { SqlClient } from "../sqlClient";
import type {
  DirectoryCrawl,
  DirectoryIndexRepository,
  DirectoryListing,
} from "@market-outreach/core";

interface ListingRow {
  id: string;
  platform: string;
  city: string;
  state: string;
  industry: string;
  business_name: string;
  profile_url: string;
  crawled_at: string;
}

interface CrawlRow {
  id: string;
  platform: string;
  city: string;
  state: string;
  industry: string;
  status: string;
  listings_found: number;
  pages_read: number;
  detail: string | null;
  crawled_at: string;
}

function toListing(row: ListingRow): DirectoryListing {
  return {
    id: row.id,
    platform: row.platform,
    city: row.city,
    state: row.state,
    industry: row.industry,
    businessName: row.business_name,
    profileUrl: row.profile_url,
    crawledAt: row.crawled_at,
  };
}

function toCrawl(row: CrawlRow): DirectoryCrawl {
  return {
    id: row.id,
    platform: row.platform,
    city: row.city,
    state: row.state,
    industry: row.industry,
    // Anything that is not exactly "complete" is treated as failed. A status
    // this code does not recognise must not be read as a finished crawl,
    // because a finished crawl is what licenses recording "no online booking".
    status: row.status === "complete" ? "complete" : "failed",
    listingsFound: row.listings_found,
    pagesRead: row.pages_read,
    detail: row.detail,
    crawledAt: row.crawled_at,
  };
}

export class SqlDirectoryIndexRepository implements DirectoryIndexRepository {
  constructor(private readonly db: SqlClient) {}

  async putListings(listings: DirectoryListing[]): Promise<number> {
    if (listings.length === 0) return 0;

    // A business keeps the same profile URL across crawls, so the natural key
    // is (platform, profile_url, industry) rather than the generated id.
    // Without that, re-crawling a town every few weeks would pile up a fresh
    // copy of every listing each time.
    const columns = [
      "id",
      "platform",
      "city",
      "state",
      "industry",
      "business_name",
      "profile_url",
      "crawled_at",
    ];
    const perChunk = Math.max(1, Math.floor(900 / columns.length));

    let written = 0;
    for (let start = 0; start < listings.length; start += perChunk) {
      const chunk = listings.slice(start, start + perChunk);
      const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
      const values: unknown[] = [];
      for (const listing of chunk) {
        values.push(
          listing.id,
          listing.platform,
          listing.city,
          listing.state,
          listing.industry,
          listing.businessName,
          listing.profileUrl,
          listing.crawledAt
        );
      }
      await this.db
        .prepare(
          `INSERT INTO directory_listings (${columns.join(", ")}) VALUES ${placeholders}
           ON CONFLICT(platform, profile_url, industry) DO UPDATE SET
             business_name = excluded.business_name,
             city = excluded.city,
             state = excluded.state,
             crawled_at = excluded.crawled_at`
        )
        .run(...values);
      written += chunk.length;
    }
    return written;
  }

  async listingsFor(scope: {
    platform: string;
    city: string;
    state: string;
    industry: string;
  }): Promise<DirectoryListing[]> {
    const rows = (await this.db
      .prepare(
        `SELECT * FROM directory_listings
         WHERE platform = @platform AND LOWER(city) = LOWER(@city)
           AND state = @state AND industry = @industry`
      )
      .all(scope)) as ListingRow[];
    return rows.map(toListing);
  }

  async recordCrawl(crawl: DirectoryCrawl): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO directory_crawls
           (id, platform, city, state, industry, status, listings_found, pages_read, detail, crawled_at)
         VALUES (@id, @platform, @city, @state, @industry, @status, @listingsFound, @pagesRead, @detail, @crawledAt)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           listings_found = excluded.listings_found,
           pages_read = excluded.pages_read,
           detail = excluded.detail,
           crawled_at = excluded.crawled_at`
      )
      .run(crawl);
  }

  async getCrawl(id: string): Promise<DirectoryCrawl | null> {
    const row = (await this.db.prepare("SELECT * FROM directory_crawls WHERE id = ?").get(id)) as
      | CrawlRow
      | undefined;
    return row ? toCrawl(row) : null;
  }

  async crawlsFor(scope: { city: string; state: string; industry: string }): Promise<DirectoryCrawl[]> {
    const rows = (await this.db
      .prepare(
        `SELECT * FROM directory_crawls
         WHERE LOWER(city) = LOWER(@city) AND state = @state AND industry = @industry`
      )
      .all(scope)) as CrawlRow[];
    return rows.map(toCrawl);
  }

  async crawlStates(): Promise<Map<string, { status: "complete" | "failed"; crawledAt: string }>> {
    const rows = (await this.db
      .prepare("SELECT id, status, crawled_at FROM directory_crawls")
      .all({})) as { id: string; status: string; crawled_at: string }[];
    return new Map(
      rows.map((row) => [
        row.id,
        // Same rule as toCrawl(): anything not exactly "complete" is failed. An
        // unrecognised status must never read as a finished crawl, because a
        // finished crawl is what licenses recording "no online booking".
        { status: row.status === "complete" ? ("complete" as const) : ("failed" as const), crawledAt: row.crawled_at },
      ])
    );
  }

  async indexTotals(): Promise<{ listings: number; complete: number; failed: number }> {
    const row = (await this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM directory_listings) AS listings,
           (SELECT COUNT(*) FROM directory_crawls WHERE status = 'complete') AS complete,
           (SELECT COUNT(*) FROM directory_crawls WHERE status <> 'complete') AS failed`
      )
      .get({})) as { listings: number; complete: number; failed: number } | undefined;
    return {
      listings: Number(row?.listings ?? 0),
      complete: Number(row?.complete ?? 0),
      failed: Number(row?.failed ?? 0),
    };
  }

  async countListings(): Promise<number> {
    const row = (await this.db.prepare("SELECT COUNT(*) AS n FROM directory_listings").get()) as
      | { n: number }
      | undefined;
    return Number(row?.n ?? 0);
  }

  async countCrawls(status?: "complete" | "failed"): Promise<number> {
    const row = (await this.db
      .prepare(
        status
          ? "SELECT COUNT(*) AS n FROM directory_crawls WHERE status = @status"
          : "SELECT COUNT(*) AS n FROM directory_crawls"
      )
      .get(status ? { status } : {})) as { n: number } | undefined;
    return Number(row?.n ?? 0);
  }
}
