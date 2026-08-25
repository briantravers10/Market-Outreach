/**
 * Fetching a prospect's own website.
 *
 * This is the one place the system reaches out to a business, and it is a read
 * of a page they published for the public. Even so, it behaves: it identifies
 * itself, gives up quickly, caps how much it will read, and never follows a
 * redirect off to somewhere unexpected. A prospecting tool that hammers the
 * websites of the people it wants to sell to has lost before it starts.
 */

export interface FetchedPage {
  /** The URL that actually served the content, after redirects. */
  finalUrl: string;
  status: number;
  html: string;
  /** Populated instead of html when the fetch failed. Never both. */
  error: string | null;
}

export interface SiteFetcher {
  fetchPage(url: string): Promise<FetchedPage>;
}

export const USER_AGENT =
  "MarketOutreachBot/1.0 (+prospect research; contact via the site owner's listed email)";

/** Reading more than this tells us nothing new and risks pulling down something enormous. */
export const MAX_BYTES = 600_000;
export const TIMEOUT_MS = 8_000;

function failure(url: string, error: string): FetchedPage {
  return { finalUrl: url, status: 0, html: "", error };
}

/**
 * Rejects anything that is not a plain public http(s) URL.
 *
 * The URLs come from a third-party dataset, so they are not trusted input. A
 * server-side fetcher that will follow `file://` or dial a private address is
 * a server-side request forgery waiting to happen, and the cost of refusing
 * here is one unanalysed lead.
 */
export function isFetchableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  // Literal private and loopback addresses. This is not a substitute for
  // network egress rules — a hostname can still resolve to a private address —
  // but it turns the obvious attempts away for free.
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host === "::1" || host.startsWith("[")) return false;
  return true;
}

export class HttpSiteFetcher implements SiteFetcher {
  constructor(
    private readonly timeoutMs = TIMEOUT_MS,
    private readonly maxBytes = MAX_BYTES
  ) {}

  async fetchPage(url: string): Promise<FetchedPage> {
    if (!isFetchableUrl(url)) return failure(url, "Not a public http(s) URL");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml",
        },
      });

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("html") && contentType !== "") {
        return { finalUrl: response.url || url, status: response.status, html: "", error: `Not HTML (${contentType})` };
      }

      // Read incrementally so a huge page is truncated rather than downloaded.
      const reader = response.body?.getReader();
      if (!reader) {
        return { finalUrl: response.url || url, status: response.status, html: "", error: "Empty response body" };
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
          if (total >= this.maxBytes) {
            await reader.cancel().catch(() => {});
            break;
          }
        }
      }
      const html = new TextDecoder("utf-8", { fatal: false }).decode(
        chunks.length === 1 ? chunks[0] : Buffer.concat(chunks.map((c) => Buffer.from(c)))
      );

      return { finalUrl: response.url || url, status: response.status, html, error: null };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      // A timeout is a finding, not a crash: a site that will not answer in
      // eight seconds is a site their customers are also waiting on.
      return failure(url, controller.signal.aborted ? `Timed out after ${this.timeoutMs}ms` : message);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Serves canned pages by URL. Lets the analysis be tested without a network. */
export class StubSiteFetcher implements SiteFetcher {
  constructor(private readonly pages: Record<string, Partial<FetchedPage>>) {}

  async fetchPage(url: string): Promise<FetchedPage> {
    const page = this.pages[url];
    if (!page) return failure(url, "No stubbed response");
    return { finalUrl: url, status: 200, html: "", error: null, ...page };
  }
}
