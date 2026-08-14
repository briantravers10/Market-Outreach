import type { BookingMethod, OnlineBookingStatus, WebsiteQuality, WebsiteStatus } from "../types";
import type { EnrichmentResult } from "../providers/enrichmentProvider";
import type { ReasoningProvider } from "../reasoning/reasoningProvider";
import { makeSeededRandom, pick } from "../mockData/random";

export interface WebsiteBookingAnalysis {
  websiteStatus: WebsiteStatus;
  websiteQuality: WebsiteQuality;
  onlineBookingStatus: OnlineBookingStatus;
  bookingMethod: BookingMethod;
  bookingProvider: string | null;
  analysisReason: string;
}

const THIRD_PARTY_PROVIDERS = ["Square Appointments", "Vagaro", "Booksy", "Fresha", "Schedulicity", "Setmore"];
const INTEGRATED_PROVIDER_LABELS = ["Custom booking widget", "Built-in platform booking"];

/**
 * Website / Booking Analysis Worker — turns raw enrichment signals into the
 * categorical judgment calls a salesperson cares about (website quality,
 * booking sophistication). Deterministic mapping for the skeleton; this is
 * the natural future seam for a real LLM to read an actual website/booking
 * flow and produce this same shape of judgment.
 */
export function runWebsiteBookingAnalysisWorker(
  businessName: string,
  enrichment: EnrichmentResult,
  jobSeed: string
): Pick<WebsiteBookingAnalysis, "websiteStatus" | "websiteQuality" | "onlineBookingStatus" | "bookingMethod" | "bookingProvider"> {
  const rng = makeSeededRandom(`${jobSeed}|${businessName}|analysis`);

  let websiteStatus: WebsiteStatus = "NONE";
  let websiteQuality: WebsiteQuality = "UNKNOWN";
  switch (enrichment.rawWebsiteSignal) {
    case "none":
      websiteStatus = "NONE";
      websiteQuality = "UNKNOWN";
      break;
    case "outdated":
      websiteStatus = "EXISTS";
      websiteQuality = "POOR";
      break;
    case "basic":
      websiteStatus = "EXISTS";
      websiteQuality = "AVERAGE";
      break;
    case "modern":
      websiteStatus = "EXISTS";
      websiteQuality = pick(rng, ["GOOD", "GOOD", "EXCELLENT"] as const);
      break;
  }

  let onlineBookingStatus: OnlineBookingStatus = "NONE";
  let bookingMethod: BookingMethod = "NONE";
  let bookingProvider: string | null = null;
  switch (enrichment.rawBookingSignal) {
    case "none":
      onlineBookingStatus = "NONE";
      bookingMethod = "NONE";
      break;
    case "phone":
      onlineBookingStatus = "NONE";
      bookingMethod = "PHONE_ONLY";
      break;
    case "social":
      onlineBookingStatus = "NONE";
      bookingMethod = "SOCIAL_DM";
      break;
    case "third_party":
      onlineBookingStatus = "THIRD_PARTY_BOOKING_SYSTEM";
      bookingMethod = "ONLINE_THIRD_PARTY";
      bookingProvider = pick(rng, THIRD_PARTY_PROVIDERS);
      break;
    case "integrated":
      onlineBookingStatus = "INTEGRATED_BOOKING_SYSTEM";
      bookingMethod = "ONLINE_INTEGRATED";
      bookingProvider = pick(rng, INTEGRATED_PROVIDER_LABELS);
      break;
  }

  return { websiteStatus, websiteQuality, onlineBookingStatus, bookingMethod, bookingProvider };
}

export async function explainWebsiteBookingAnalysis(
  businessName: string,
  analysis: Pick<WebsiteBookingAnalysis, "websiteQuality" | "bookingMethod">,
  reasoning: ReasoningProvider
): Promise<string> {
  return reasoning.explainWebsiteBookingAnalysis({
    businessName,
    websiteQuality: analysis.websiteQuality,
    bookingMethod: analysis.bookingMethod,
  });
}
