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
};

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
};

export function generateBusinessName(rng: Rng, industryId: string): string {
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
