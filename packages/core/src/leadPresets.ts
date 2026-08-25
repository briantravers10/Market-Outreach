import type { Lead } from "./types";

/**
 * The saved views on the High-Priority page.
 *
 * These live in core rather than in the page because the CSV export has to
 * produce exactly the rows on screen. Two copies of "strong reviews + poor
 * digital infra" would drift, and the first sign of it would be an export that
 * quietly disagrees with the table above it.
 */
export interface LeadPreset {
  key: string;
  label: string;
  test: (lead: Lead) => boolean;
}

export const LEAD_PRESETS: LeadPreset[] = [
  {
    key: "no-website-no-booking",
    label: "No website + no booking",
    test: (l) => l.websiteStatus === "NONE" && l.onlineBookingStatus === "NONE" && l.bookingMethod === "NONE",
  },
  {
    key: "poor-website-no-booking",
    label: "Poor website + no booking",
    test: (l) => l.websiteQuality === "POOR" && l.onlineBookingStatus === "NONE",
  },
  {
    key: "social-no-website",
    label: "Active social + no website",
    test: (l) => l.socialActivity === "ACTIVE" && l.websiteStatus === "NONE",
  },
  {
    key: "reviews-poor-infra",
    label: "Strong reviews + poor digital infra",
    test: (l) => (l.rating ?? 0) >= 4.4 && (l.reviewCount ?? 0) >= 40 && (l.websiteStatus === "NONE" || l.websiteQuality === "POOR"),
  },
  {
    key: "staff-phone-only",
    label: "Multiple staff + phone-only booking",
    test: (l) => (l.staffCount ?? 0) >= 3 && l.bookingMethod === "PHONE_ONLY",
  },
];

export function findLeadPreset(key: string | undefined): LeadPreset | undefined {
  return key ? LEAD_PRESETS.find((preset) => preset.key === key) : undefined;
}
