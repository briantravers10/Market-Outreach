/**
 * Which voices the Manager can speak in, and how to find them on a device.
 *
 * The owner asked for eight specific accent-and-gender combinations and was
 * explicit that accents must not be faked through prompt instructions. They are
 * not: these are real native voices installed on the operating system, selected
 * by name and by BCP-47 language tag. An Irish voice here is Moira or Fiona
 * actually speaking Irish English, not an American voice told to sound Irish.
 *
 * WHY THE BROWSER'S OWN ENGINE, AND WHAT IT COSTS
 *
 * Speaking happens through the Web Speech API, which is already what this
 * project uses. It needs no key, costs nothing per minute, adds no latency and
 * sends no audio anywhere. The trade is that the available set differs per
 * device: an iPhone or Mac carries excellent voices for all eight of these,
 * Windows carries several, and a bare Android or Linux browser may carry only
 * one or two. So every profile lists several candidate voices and the resolver
 * degrades honestly — it reports what it actually matched, and the UI says so,
 * rather than silently substituting an American voice for the Irish one and
 * leaving the owner to wonder why his setting did nothing.
 *
 * A paid provider (ElevenLabs, OpenAI, PlayHT) would sound better still and
 * would be identical on every device. That is a real upgrade and a real cost —
 * a key, a per-character bill, and every spoken reply leaving the machine — so
 * it is a decision for the owner rather than something to add quietly. The
 * shape here is the seam it would slot into: profiles are chosen by id, and
 * where those ids are turned into audio is one function.
 */

export type VoiceGender = "female" | "male";
export type VoiceAccent = "british" | "irish" | "american" | "australian";

export interface VoiceProfile {
  id: string;
  label: string;
  accent: VoiceAccent;
  gender: VoiceGender;
  /** BCP-47 tags this accent legitimately speaks, best first. */
  langs: string[];
  /**
   * Known good voice names, best first.
   *
   * Matched case-insensitively as a substring, because vendors decorate the
   * same voice differently — "Daniel" appears as "Daniel", "Daniel (Enhanced)"
   * and "Microsoft Daniel - English (United Kingdom)" on three platforms.
   */
  names: string[];
}

/**
 * Ordered as the owner listed them, so the settings screen reads back the way
 * the request was made.
 */
export const VOICE_PROFILES: VoiceProfile[] = [
  {
    id: "british-female",
    label: "British — female",
    accent: "british",
    gender: "female",
    langs: ["en-GB"],
    names: ["Kate", "Serena", "Stephanie", "Google UK English Female", "Libby", "Sonia", "Hazel", "Martha", "Amelie"],
  },
  {
    id: "british-male",
    label: "British — male",
    accent: "british",
    gender: "male",
    langs: ["en-GB"],
    names: ["Daniel", "Oliver", "Arthur", "Google UK English Male", "Ryan", "George", "Malcolm"],
  },
  {
    id: "irish-female",
    label: "Irish — female",
    accent: "irish",
    gender: "female",
    langs: ["en-IE"],
    names: ["Moira", "Fiona", "Emily", "Orla"],
  },
  {
    id: "irish-male",
    label: "Irish — male",
    accent: "irish",
    gender: "male",
    langs: ["en-IE"],
    // Irish male voices are the scarcest of the eight. Named honestly rather
    // than padded with British names that would quietly resolve to the wrong
    // accent and look like it worked.
    names: ["Connor", "Sean"],
  },
  {
    id: "american-female",
    label: "American — female",
    accent: "american",
    gender: "female",
    langs: ["en-US"],
    names: ["Samantha", "Ava", "Allison", "Susan", "Google US English", "Jenny", "Aria", "Zira"],
  },
  {
    id: "american-male",
    label: "American — male",
    accent: "american",
    gender: "male",
    langs: ["en-US"],
    names: ["Alex", "Tom", "Evan", "Nathan", "Guy", "Christopher", "David", "Aaron"],
  },
  {
    id: "australian-female",
    label: "Australian — female",
    accent: "australian",
    gender: "female",
    langs: ["en-AU"],
    names: ["Karen", "Catherine", "Natasha", "Google Australian English", "Zoe"],
  },
  {
    id: "australian-male",
    label: "Australian — male",
    accent: "australian",
    gender: "male",
    langs: ["en-AU"],
    names: ["Lee", "William", "Gordon", "James"],
  },
];

export const DEFAULT_VOICE_PROFILE_ID = "british-female";

export function findVoiceProfile(id: string | null | undefined): VoiceProfile | null {
  if (!id) return null;
  return VOICE_PROFILES.find((p) => p.id === id) ?? null;
}

/** The bare facts about an installed voice, so this module needs no DOM types. */
export interface InstalledVoice {
  name: string;
  lang: string;
}

export type VoiceMatchQuality =
  /** A named voice from the profile. Exactly what was asked for. */
  | "exact"
  /** Right accent, unlisted voice. Still genuinely that accent. */
  | "accent"
  /** English, wrong accent. The setting could not be honoured. */
  | "fallback"
  /** Nothing usable at all. */
  | "none";

export interface VoiceResolution {
  voice: InstalledVoice | null;
  quality: VoiceMatchQuality;
  /** One line for the settings screen. Says plainly when the accent is not the one chosen. */
  explanation: string;
}

/**
 * Picks the best installed voice for a profile, and says how good the match is.
 *
 * The three tiers matter because a silent downgrade is the failure mode worth
 * designing against: choosing "Irish — male" on a device with no Irish voice
 * and hearing an American one, with the setting still reading Irish, makes the
 * feature look broken in a way that is hard to diagnose.
 */
/**
 * Voice names this catalogue positively knows to be one gender.
 *
 * Built from the profiles themselves so it can never drift from them, and used
 * only to EXCLUDE — an unknown name is never assumed to be either.
 */
function knownNamesForGender(gender: VoiceGender): Set<string> {
  const names = new Set<string>();
  for (const profile of VOICE_PROFILES) {
    if (profile.gender !== gender) continue;
    for (const name of profile.names) names.add(name.toLowerCase().trim());
  }
  return names;
}

export function resolveVoice(profile: VoiceProfile, installed: InstalledVoice[]): VoiceResolution {
  const usable = installed.filter((v) => typeof v.name === "string" && v.name.length > 0);

  // Named voices, in the profile's own order of preference.
  for (const wanted of profile.names) {
    const needle = wanted.toLowerCase();
    const hit = usable.find((v) => v.name.toLowerCase().includes(needle));
    if (hit) {
      return { voice: hit, quality: "exact", explanation: `Using ${hit.name}.` };
    }
  }

  /**
   * Any voice genuinely speaking this accent — but never one we know to be the
   * other gender.
   *
   * Without that exclusion, asking for "Irish — male" on a device whose only
   * Irish voice is Moira returned Moira and called it "the right accent". The
   * accent was right and the gender was wrong, and it was reported as a good
   * match: precisely the silent substitution this function exists to prevent.
   * The owner asked for eight combinations, not four.
   *
   * Names we have never heard of are still allowed, because refusing them would
   * reject perfectly good voices on devices we cannot enumerate — but the
   * explanation says the gender is not guaranteed rather than implying it is.
   */
  const otherGender = knownNamesForGender(profile.gender === "female" ? "male" : "female");
  for (const lang of profile.langs) {
    const candidates = usable.filter((v) => (v.lang ?? "").toLowerCase().startsWith(lang.toLowerCase()));
    const sameGender = candidates.filter((v) => !otherGender.has(v.name.toLowerCase().trim()));
    const hit = sameGender[0];
    if (hit) {
      return {
        voice: hit,
        quality: "accent",
        explanation: `Using ${hit.name} — the right accent, though not a voice we know by name, so the ${profile.gender} tone is not guaranteed.`,
      };
    }
  }

  /**
   * Any English voice at all. The accent is wrong and the screen must say so.
   *
   * Same gender exclusion as above, and for the same reason: falling back from
   * "Irish male" to an Irish FEMALE voice is not a smaller compromise than
   * falling back to an English male one, it is a different voice entirely.
   * Only when nothing else exists is an opposite-gender voice used, and then
   * the explanation names both things that are wrong rather than one.
   */
  const english = usable.filter((v) => (v.lang ?? "").toLowerCase().startsWith("en"));
  const preferred = english.find((v) => !otherGender.has(v.name.toLowerCase().trim()));
  if (preferred) {
    return {
      voice: preferred,
      quality: "fallback",
      explanation: `This device has no ${profile.accent} voice installed, so ${preferred.name} is being used instead. The accent will not be the one you picked.`,
    };
  }
  if (english[0]) {
    return {
      voice: english[0],
      quality: "fallback",
      explanation: `This device has no ${profile.accent} voice and no ${profile.gender} English voice, so ${english[0].name} is being used. Neither the accent nor the tone will be what you picked.`,
    };
  }

  return {
    voice: null,
    quality: "none",
    explanation: "This device has no English speech voices installed, so replies cannot be spoken aloud.",
  };
}

/** Which of the eight are genuinely available here, for the settings screen. */
export function describeAvailability(installed: InstalledVoice[]): {
  profile: VoiceProfile;
  resolution: VoiceResolution;
}[] {
  return VOICE_PROFILES.map((profile) => ({ profile, resolution: resolveVoice(profile, installed) }));
}
