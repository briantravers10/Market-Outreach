import { DEFAULT_VOICE_PROFILE_ID, findVoiceProfile } from "./voiceProfiles";

/**
 * The owner's voice and persona preferences, stored rather than compiled in.
 *
 * The requirement was explicit: rename the assistant from "Manager" to
 * anything, change its greeting, its voice and its speed, all without editing
 * code. So these live in the existing app_settings table under one key — no
 * migration, and the same read/write path the spending cap already uses.
 *
 * Everything is validated on the way in and clamped on the way out. This is
 * read on every page load and fed straight into the speech engine and the
 * assistant's own greeting, so a hand-edited value must never be able to leave
 * the assistant unusable or unnamed.
 */

export const VOICE_SETTINGS_KEY = "manager_voice_settings";

export interface VoiceSettings {
  /** Id from VOICE_PROFILES. */
  voiceProfileId: string;
  /** Speaking rate. 1 is the engine's normal pace. */
  rate: number;
  /** What the assistant is called, everywhere it is named. */
  assistantName: string;
  /** First thing it says when opened. Empty means say nothing. */
  greeting: string;
  /** Speak replies aloud by default. */
  speakReplies: boolean;
  /**
   * After speaking, re-open the microphone so a conversation continues without
   * reaching for the button on every turn.
   */
  handsFree: boolean;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  voiceProfileId: DEFAULT_VOICE_PROFILE_ID,
  rate: 1,
  assistantName: "Manager",
  greeting: "",
  speakReplies: true,
  handsFree: false,
};

/**
 * Rate bounds.
 *
 * Below about 0.6 the browser engines slur badly and above about 1.6 they are
 * hard to follow, so the slider stops well inside where it still sounds like a
 * person. Wider would technically work and would not be usable.
 */
export const MIN_RATE = 0.6;
export const MAX_RATE = 1.6;

const MAX_NAME = 40;
const MAX_GREETING = 240;

function clampRate(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_VOICE_SETTINGS.rate;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(n * 100) / 100));
}

function cleanText(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  // Collapsed and stripped of control characters: this string is spoken aloud
  // and rendered as a heading, and a newline in either place is a defect.
  const clean = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return fallback;
  return clean.slice(0, max);
}

/**
 * Parses whatever is in storage into settings that are always usable.
 *
 * Never throws and never returns a partial object. A corrupt value costs the
 * owner their preferences, which is recoverable; a crash in a component that
 * renders on every page is not.
 */
export function parseVoiceSettings(raw: string | null | undefined): VoiceSettings {
  if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
  if (!parsed || typeof parsed !== "object") return { ...DEFAULT_VOICE_SETTINGS };
  const record = parsed as Record<string, unknown>;

  // An unknown voice id falls back rather than being kept: the id is handed to
  // the speech engine, and a stale one would leave the assistant mute.
  const requested = typeof record.voiceProfileId === "string" ? record.voiceProfileId : null;
  const voiceProfileId = findVoiceProfile(requested)?.id ?? DEFAULT_VOICE_SETTINGS.voiceProfileId;

  return {
    voiceProfileId,
    rate: clampRate(record.rate),
    assistantName: cleanText(record.assistantName, MAX_NAME, DEFAULT_VOICE_SETTINGS.assistantName),
    // A greeting may legitimately be empty — that means "just open, say nothing".
    greeting:
      typeof record.greeting === "string"
        ? cleanText(record.greeting, MAX_GREETING, "")
        : DEFAULT_VOICE_SETTINGS.greeting,
    speakReplies:
      typeof record.speakReplies === "boolean" ? record.speakReplies : DEFAULT_VOICE_SETTINGS.speakReplies,
    handsFree: typeof record.handsFree === "boolean" ? record.handsFree : DEFAULT_VOICE_SETTINGS.handsFree,
  };
}

/** Validates a form submission into settings, reporting anything it had to correct. */
export function voiceSettingsFromForm(fields: Record<string, unknown>): {
  settings: VoiceSettings;
  corrections: string[];
} {
  const corrections: string[] = [];

  const requestedVoice = typeof fields.voiceProfileId === "string" ? fields.voiceProfileId : "";
  const profile = findVoiceProfile(requestedVoice);
  if (requestedVoice && !profile) {
    corrections.push(`"${requestedVoice}" is not a voice I know, so the default was kept.`);
  }

  const rawRate = typeof fields.rate === "string" ? Number(fields.rate) : fields.rate;
  const rate = clampRate(rawRate);
  if (Number.isFinite(Number(rawRate)) && Math.abs(Number(rawRate) - rate) > 0.001) {
    corrections.push(`Speed was adjusted to ${rate} — outside ${MIN_RATE} to ${MAX_RATE} is hard to follow.`);
  }

  const name = cleanText(fields.assistantName, MAX_NAME, DEFAULT_VOICE_SETTINGS.assistantName);
  if (typeof fields.assistantName === "string" && fields.assistantName.trim().length > MAX_NAME) {
    corrections.push(`The name was shortened to ${MAX_NAME} characters.`);
  }

  return {
    settings: {
      voiceProfileId: profile?.id ?? DEFAULT_VOICE_SETTINGS.voiceProfileId,
      rate,
      assistantName: name,
      greeting: cleanText(fields.greeting, MAX_GREETING, ""),
      speakReplies: fields.speakReplies === "on" || fields.speakReplies === true,
      handsFree: fields.handsFree === "on" || fields.handsFree === true,
    },
    corrections,
  };
}

export function serialiseVoiceSettings(settings: VoiceSettings): string {
  return JSON.stringify(settings);
}

/**
 * The greeting actually spoken when the assistant opens.
 *
 * Falls back to one built from the name so a blank greeting still sounds like
 * something rather than silence — but only when the owner has never set one.
 * Having deliberately cleared it is respected.
 */
export function greetingFor(settings: VoiceSettings, hasBeenConfigured: boolean): string {
  if (settings.greeting) return settings.greeting;
  if (hasBeenConfigured) return "";
  return `${settings.assistantName} here. What do you need?`;
}
