import type { DetectedLink } from "@market-outreach/core";
import { analyzeLinks } from "@market-outreach/core";

const PURPOSE_LABEL: Record<DetectedLink["purpose"], string> = {
  booking: "Booking",
  payment: "Payment",
  contact: "Contact",
  social: "Social",
  review: "Reviews",
  website: "Website",
  menu: "Prices",
  other: "Other",
};

/**
 * Shows what a prospect's link-in-bio page reveals. For social-first
 * businesses this is the strongest qualification evidence available, so the
 * commercial read is stated first and the raw links back it up underneath.
 */
export function LinkInBio({ url, links }: { url: string | null; links: DetectedLink[] }) {
  if (!url) {
    return (
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        No link-in-bio page found for this business.
      </p>
    );
  }

  const analysis = analyzeLinks(links);

  return (
    <div>
      <p style={{ marginTop: 0, fontSize: 12 }}>
        <span className="muted">Source: </span>
        <code style={{ fontSize: 11, wordBreak: "break-all" }}>{url}</code>
      </p>

      <p className={analysis.hasBookingLink ? "disabled-banner" : "notice-success"} style={{ marginTop: 10 }}>
        {analysis.summary}
      </p>

      {links.length > 0 && (
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Type</th>
              <th>Destination</th>
              <th>Link text</th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.url}>
                <td>
                  <span className={`link-purpose purpose-${l.purpose}`}>{PURPOSE_LABEL[l.purpose]}</span>
                </td>
                <td>{l.provider ?? <span className="muted">{hostOf(l.url)}</span>}</td>
                <td className="muted" style={{ fontSize: 12 }}>{l.label ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
