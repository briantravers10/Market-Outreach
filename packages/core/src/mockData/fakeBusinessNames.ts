import { pick, type Rng } from "./random";

/**
 * Purely synthetic name components. These are generic word banks
 * (never real business names) used only to generate obviously-fake
 * test leads for the skeleton phase.
 */
const PREFIXES = [
  "Sunset",
  "Golden",
  "Ocean",
  "Downtown",
  "Elite",
  "Prestige",
  "Urban",
  "Coastal",
  "Royal",
  "Modern",
  "Bright",
  "Blue Palm",
  "Silver",
  "Vivid",
  "Skyline",
];

const SUFFIX_BY_INDUSTRY: Record<string, string[]> = {
  barbers: ["Barbershop", "Barber Co.", "Cuts", "Fade House", "Grooming Lounge"],
  "hair-salons": ["Hair Studio", "Salon", "Hair Lounge", "Hair Bar", "Beauty Collective"],
  "nail-salons": ["Nail Bar", "Nails & Spa", "Nail Studio", "Nail Lounge", "Nail Co."],
  "dog-groomers": ["Pet Grooming", "Dog Spa", "Paws & Clip", "Grooming Co.", "Bark & Bathe"],
  "lash-brow-studios": ["Lash Studio", "Brow Bar", "Lash & Brow Co.", "Beauty Lash Lounge", "Lash Loft"],
  estheticians: ["Skin Studio", "Esthetics Co.", "Skincare Lounge", "Facial Bar", "Glow Studio"],
  "massage-therapists": ["Massage Therapy", "Wellness Massage", "Massage Studio", "Bodywork Co.", "Zen Massage"],
  "personal-trainers": ["Fitness Studio", "Training Co.", "Strength Lab", "Performance Training", "Fit Studio"],
  "tattoo-studios": ["Tattoo Co.", "Ink Studio", "Tattoo Parlor", "Ink House", "Tattoo Collective"],
  "car-detailers": ["Auto Detailing", "Detail Co.", "Mobile Detailing", "Shine Auto Spa", "Detail Studio"],
  // Makeup artists overwhelmingly trade under a personal brand rather than a
  // storefront name, so they get their own generator below instead of the
  // prefix+suffix shape the premises-based industries use.
  "makeup-artists": ["Makeup Artistry", "Beauty", "Glam Studio", "Makeup Co.", "Artistry"],
};

/** Synthetic first names — used only for personal-brand industries. Never real people. */
const FAKE_FIRST_NAMES = [
  "Ana", "Mari", "Nia", "Cleo", "Rae", "Sol", "Ivy", "Jo",
  "Lux", "Zia", "Noor", "Isa", "Vee", "Kai", "Wren",
];

const PERSONAL_BRAND_TEMPLATES = [
  "{name} Beauty",
  "Glam by {name}",
  "{name} Makeup Artistry",
  "Beauty by {name}",
  "{name} MUA",
  "Studio {name}",
];

const STREET_NAMES = [
  "Ocean Ave",
  "Palm Blvd",
  "Federal Hwy",
  "Atlantic Ave",
  "Main St",
  "Las Olas Blvd",
  "Biscayne Blvd",
  "Congress Ave",
  "Dixie Hwy",
  "5th St",
];

const SERVICES_BY_INDUSTRY: Record<string, string[]> = {
  barbers: ["Haircut", "Beard Trim", "Hot Towel Shave", "Kids Cut", "Fade"],
  "hair-salons": ["Cut & Style", "Color", "Balayage", "Blowout", "Treatment"],
  "nail-salons": ["Manicure", "Pedicure", "Gel Nails", "Acrylics", "Nail Art"],
  "dog-groomers": ["Full Groom", "Bath & Brush", "Nail Trim", "De-shedding", "Puppy Groom"],
  "lash-brow-studios": ["Lash Extensions", "Lash Lift", "Brow Shaping", "Brow Tint", "Lash Fill"],
  estheticians: ["Facial", "Chemical Peel", "Microdermabrasion", "Waxing", "Skin Consult"],
  "massage-therapists": ["Swedish Massage", "Deep Tissue", "Sports Massage", "Prenatal Massage", "Hot Stone"],
  "personal-trainers": ["1:1 Training", "Small Group Training", "Nutrition Coaching", "Assessment", "Online Coaching"],
  "tattoo-studios": ["Custom Tattoo", "Flash Tattoo", "Touch-up", "Cover-up", "Piercing"],
  "car-detailers": ["Full Detail", "Interior Detail", "Ceramic Coating", "Paint Correction", "Mobile Detail"],
  "makeup-artists": ["Bridal Makeup", "Event Makeup", "Editorial Makeup", "Airbrush", "Makeup Lesson", "Special Occasion"],
};

/** Industries whose businesses trade under a person's name rather than a storefront name. */
const PERSONAL_BRAND_INDUSTRIES = new Set(["makeup-artists"]);

/**
 * Synthetic multi-location franchise brands. Invented names, never real ones.
 *
 * These exist because "independent vs. chain" is a real prospecting
 * distinction — a franchise usually can't choose its own booking software, so
 * it's a poor prospect no matter how good its other signals look. Without any
 * chain-shaped businesses in the generated data, an instruction like "stop
 * including national chains" would have nothing to act on, and the exclusion
 * would appear to work while doing nothing.
 *
 * Marked by the shared franchise-style suffixes below so a name-pattern
 * exclusion has a real, checkable signal to match on.
 */
const CHAIN_BRANDS: Record<string, string[]> = {
  barbers: ["ClipZone Express", "FadeNation", "SharpCo Barber Group"],
  "hair-salons": ["StyleNation", "GlossBar Express", "HairCo Group"],
  "nail-salons": ["NailNation", "PolishPro Express", "TipTop Nails Group"],
  "dog-groomers": ["PawNation", "GroomCo Express", "FurFresh Group"],
  "lash-brow-studios": ["LashNation", "BrowCo Express"],
  estheticians: ["GlowNation", "SkinCo Express"],
  "massage-therapists": ["RelaxNation", "MassageCo Express"],
  "personal-trainers": ["FitNation", "StrengthCo Express"],
  "tattoo-studios": ["InkNation"],
  "car-detailers": ["ShineNation", "DetailCo Express"],
};

/**
 * Roughly one in six generated businesses is a chain, in industries that have
 * them. Personal-brand industries (makeup artists) never are — a franchise
 * makeup artist isn't a thing.
 */
const CHAIN_PROBABILITY = 1 / 6;

/**
 * The franchise-style tokens shared by every CHAIN_BRANDS entry.
 *
 * Deliberately excludes "co." — the independent word bank already uses it
 * heavily ("Detail Co.", "Barber Co.", "Grooming Co."), so matching on it
 * would flag ordinary independents as chains. Every token here was checked
 * against PREFIXES and SUFFIX_BY_INDUSTRY for collisions; the unit test in
 * scripts/test-manager.ts re-checks that as the word banks grow.
 */
export const CHAIN_NAME_PATTERNS = ["nation", "express", "group"];

/**
 * Whether a business name looks like a multi-location franchise rather than an
 * independent operator. Name-based and therefore a heuristic, which is why the
 * Manager reports it as "looks like a chain" rather than asserting it.
 */
export function looksLikeChain(businessName: string): boolean {
  const lower = businessName.toLowerCase();
  return CHAIN_NAME_PATTERNS.some((token) => lower.includes(token));
}

export function generateBusinessName(rng: Rng, industryId: string): string {
  if (PERSONAL_BRAND_INDUSTRIES.has(industryId)) {
    return pick(rng, PERSONAL_BRAND_TEMPLATES).replace("{name}", pick(rng, FAKE_FIRST_NAMES));
  }
  const chains = CHAIN_BRANDS[industryId];
  if (chains && rng() < CHAIN_PROBABILITY) {
    return pick(rng, chains);
  }
  const suffixOptions = SUFFIX_BY_INDUSTRY[industryId] ?? ["Studio"];
  return `${pick(rng, PREFIXES)} ${pick(rng, suffixOptions)}`;
}

export function generateStreetAddress(rng: Rng): string {
  const number = Math.floor(rng() * 8000) + 100;
  return `${number} ${pick(rng, STREET_NAMES)}`;
}

export function generateZip(rng: Rng): string {
  return String(33000 + Math.floor(rng() * 999));
}

export function generateServices(rng: Rng, industryId: string, count: number): string[] {
  const pool = SERVICES_BY_INDUSTRY[industryId] ?? ["General Service"];
  const shuffled = [...pool].sort(() => rng() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export function generatePhone(rng: Rng): string {
  const area = pick(rng, ["305", "954", "561"]); // Miami / Fort Lauderdale / Delray-area codes, fake numbers only
  const mid = String(Math.floor(rng() * 900) + 100);
  const last = String(Math.floor(rng() * 9000) + 1000);
  return `(${area}) ${mid}-${last}`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
