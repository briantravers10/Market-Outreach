"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  VOICE_SETTINGS_KEY,
  serialiseVoiceSettings,
  voiceSettingsFromForm,
} from "@market-outreach/core";
import { getRepos } from "./data";
import { isDemoMode } from "./demo";

/**
 * Saving the owner's voice and persona preferences.
 *
 * Validation happens here rather than in the form, because a form is only a
 * suggestion — anything can post to a server action. voiceSettingsFromForm
 * refuses an unknown voice id, clamps the speed, and shortens an over-long
 * name, then reports what it had to change so the screen can say so instead of
 * silently storing something other than what was asked for.
 */
export async function saveVoiceSettingsAction(form: FormData): Promise<void> {
  if (isDemoMode) return;

  const { settings, corrections } = voiceSettingsFromForm({
    voiceProfileId: form.get("voiceProfileId"),
    rate: form.get("rate"),
    assistantName: form.get("assistantName"),
    greeting: form.get("greeting"),
    speakReplies: form.get("speakReplies"),
    handsFree: form.get("handsFree"),
  });

  await getRepos().settings.set(VOICE_SETTINGS_KEY, serialiseVoiceSettings(settings));

  // The assistant is rendered by the dashboard layout, so its name, greeting
  // and voice are stale on every page until this is revalidated — not just on
  // the settings page the change was made from.
  revalidatePath("/", "layout");

  const params = new URLSearchParams({ saved: "voice" });
  if (corrections.length > 0) params.set("adjusted", corrections.join(" "));
  redirect(`/settings?${params.toString()}`);
}
