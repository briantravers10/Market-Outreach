import type { Lead } from "../types";

/**
 * Spreadsheet export.
 *
 * CSV rather than a real .xlsx file, deliberately: Excel, Numbers and Google
 * Sheets all open CSV natively with a double-click, it needs no third-party
 * library, and it can't carry macros. Nothing has to be "connected" to
 * anything — the file is just downloaded and opened.
 */

/** Excel only reads a UTF-8 CSV correctly when it starts with a byte-order mark. */
export const CSV_BOM = "﻿";

function isPlainNumber(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value);
}

/**
 * Escape one field for CSV.
 *
 * Two separate jobs here. The first is ordinary CSV quoting. The second is a
 * formula-injection guard: a spreadsheet treats a cell beginning with = + - @
 * as a formula, so a business name like `=HYPERLINK(...)` would execute on
 * open. Today the names are generated locally, but this file exists precisely
 * so that real, externally-sourced business names can be reviewed in Excel —
 * so the guard goes in now, not after the data becomes untrusted. A leading
 * apostrophe is the standard neutraliser; plain numbers are exempted so
 * negative values don't all pick up a stray quote.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+@\t\r]/.test(text) || (text.startsWith("-") && !isPlainNumber(text))) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvField).join(",");
}

/** Column order is the order a human reads a lead in: who, how good, where, how to reach them, then evidence. */
const COLUMNS = [
  "Business Name",
  "Industry",
  "Score",
  "Qualification",
  "Data Confidence",
  "City",
  "State",
  "ZIP",
  "Address",
  "Service Area",
  "Location Confidence",
  "Phone",
  "Email",
  "Website",
  "Website Status",
  "Website Quality",
  "Online Booking",
  "Booking Provider",
  "Booking Method",
  "Staff Count",
  "Rating",
  "Review Count",
  "Instagram",
  "Facebook",
  "Social Activity",
  "Link In Bio",
  "Services",
  "Why This Score",
  "Discovery Source",
  "Date Discovered",
  "Date Last Researched",
  "Research Status",
  "Pipeline Stage",
  "Stages Completed",
  "Duplicate Of",
  "Campaign ID",
  "Lead ID",
  "Notes",
] as const;

export interface LeadsCsvOptions {
  /** Turns an industry id into the label the dashboard shows. Falls back to the id. */
  industryLabel?: (industryId: string) => string;
}

function readable(value: string | null): string {
  return value ? value.replace(/_/g, " ").toLowerCase() : "";
}

export function leadsToCsv(leads: Lead[], options: LeadsCsvOptions = {}): string {
  const label = options.industryLabel ?? ((id: string) => id);
  const lines = [csvRow([...COLUMNS])];

  for (const lead of leads) {
    lines.push(
      csvRow([
        lead.businessName,
        label(lead.industry),
        lead.prospectScore,
        readable(lead.qualificationStatus),
        readable(lead.dataConfidence),
        lead.city,
        lead.state,
        lead.zip,
        lead.address,
        lead.serviceArea,
        readable(lead.locationConfidence),
        lead.phone,
        lead.email,
        lead.website,
        readable(lead.websiteStatus),
        readable(lead.websiteQuality),
        readable(lead.onlineBookingStatus),
        lead.bookingProvider,
        readable(lead.bookingMethod),
        lead.staffCount,
        lead.rating,
        lead.reviewCount,
        lead.instagram,
        lead.facebook,
        readable(lead.socialActivity),
        lead.linkInBioUrl,
        lead.services.join("; "),
        lead.scoreReason,
        lead.discoverySource,
        lead.dateDiscovered,
        lead.dateLastResearched,
        readable(lead.researchStatus),
        readable(lead.pipelineStage),
        lead.stagesCompleted.join("; "),
        lead.isDuplicateOf,
        lead.campaignId,
        lead.id,
        lead.notes,
      ])
    );
  }

  // Trailing newline: some tools drop the last row without one.
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

/** e.g. leads-2026-08-25.csv — sorted usefully when several are saved in one folder. */
export function csvFilename(prefix: string, now: Date): string {
  return `${prefix}-${now.toISOString().slice(0, 10)}.csv`;
}
