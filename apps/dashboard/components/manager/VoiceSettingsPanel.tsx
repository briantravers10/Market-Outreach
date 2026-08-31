"use client";

import { useEffect, useMemo, useState } from "react";
import {
  VOICE_PROFILES,
  findVoiceProfile,
  resolveVoice,
  type InstalledVoice,
} from "@market-outreach/core/manager/voiceProfiles";
import { MAX_RATE, MIN_RATE, type VoiceSettings } from "@market-outreach/core/manager/voiceSettings";
import { saveVoiceSettingsAction } from "../../lib/voiceSettingsActions";

/**
 * Choosing how the assistant sounds and what it is called.
 *
 * A client component for one reason: which voices exist is a property of the
 * device, not the server. The same page opened on a Mac and on an Android phone
 * can genuinely do different things, and the only honest way to show that is to
 * ask the browser. So each of the eight is labelled with what it would actually
 * resolve to HERE — including saying plainly when the accent is not available
 * and something else would be substituted.
 *
 * Previewing speaks through exactly the same resolver the assistant uses, so
 * what is heard here is what will be heard there.
 */

const SAMPLE = "Morning. Scout found eighty-three new leads overnight, and forty-one look worth a call.";

export function VoiceSettingsPanel({ settings }: { settings: VoiceSettings }) {
  const [installed, setInstalled] = useState<InstalledVoice[] | null>(null);
  const [selected, setSelected] = useState(settings.voiceProfileId);
  const [rate, setRate] = useState(settings.rate);
  const [previewing, setPreviewing] = useState(false);

  /**
   * The voice list arrives asynchronously and starts empty on most browsers —
   * Safari does not populate it until synthesis has been touched at least once,
   * and Chrome fires `voiceschanged` some time after load. Reading it once on
   * mount would show "no voices installed" on a device full of them.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setInstalled([]);
      return;
    }
    const read = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) setInstalled(voices.map((v) => ({ name: v.name, lang: v.lang })));
    };
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    // A late poll for Safari, which sometimes never fires the event at all.
    const timer = window.setTimeout(read, 1200);
    /**
     * Give up and say so.
     *
     * An empty list is indistinguishable from a list that has not arrived yet,
     * so this used to wait forever: on a device with genuinely no speech voices
     * — a bare Linux browser, some locked-down Android builds — the panel sat on
     * "Checking…" permanently with the preview button disabled and no reason
     * given. Settling on an empty list lets the resolver report the truth,
     * which is that nothing here can speak.
     */
    const giveUp = window.setTimeout(() => {
      setInstalled((current) => current ?? (window.speechSynthesis.getVoices().length > 0
        ? window.speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang }))
        : []));
    }, 2500);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", read);
      window.clearTimeout(timer);
      window.clearTimeout(giveUp);
    };
  }, []);

  const availability = useMemo(() => {
    if (!installed) return null;
    return new Map(
      VOICE_PROFILES.map((profile) => [profile.id, resolveVoice(profile, installed)] as const)
    );
  }, [installed]);

  const currentResolution = availability?.get(selected) ?? null;

  const preview = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !installed) return;
    const profile = findVoiceProfile(selected);
    if (!profile) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(SAMPLE);
    const resolution = resolveVoice(profile, installed);
    const voices = window.speechSynthesis.getVoices();
    const match = resolution.voice
      ? voices.find((v) => v.name === resolution.voice?.name && v.lang === resolution.voice?.lang)
      : undefined;
    if (match) {
      utterance.voice = match;
      utterance.lang = match.lang;
    } else {
      utterance.lang = profile.langs[0];
    }
    utterance.rate = rate;
    utterance.onstart = () => setPreviewing(true);
    utterance.onend = () => setPreviewing(false);
    utterance.onerror = () => setPreviewing(false);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="panel">
      <h2>
        Voice &amp; assistant <small>how it sounds, and what it is called</small>
      </h2>

      <form action={saveVoiceSettingsAction} className="spend-form">
        <label className="field-label voice-field-wide">
          Voice
          <select
            className="auth-input"
            name="voiceProfileId"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {VOICE_PROFILES.map((profile) => {
              const resolution = availability?.get(profile.id);
              // The label carries the verdict, so a voice this device cannot do
              // is visible before it is chosen rather than after it sounds wrong.
              const suffix = !resolution
                ? ""
                : resolution.quality === "exact"
                  ? ` — ${resolution.voice?.name}`
                  : resolution.quality === "accent"
                    ? ` — ${resolution.voice?.name} (unlisted)`
                    : resolution.quality === "fallback"
                      ? " — not on this device"
                      : " — unavailable";
              return (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                  {suffix}
                </option>
              );
            })}
          </select>
        </label>

        <div className="voice-preview">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={preview}
            disabled={!installed || installed.length === 0}
            title={
              installed && installed.length === 0
                ? "This device has no speech voices installed, so there is nothing to preview."
                : undefined
            }
          >
            {previewing ? "Speaking…" : "Preview this voice"}
          </button>
        </div>

        <p className="muted voice-verdict">
          {installed === null
            ? "Checking which voices this device has…"
            : currentResolution
              ? currentResolution.explanation
              : "Choose a voice."}
        </p>

        <label className="field-label">
          Speaking speed <span className="muted">{rate.toFixed(2)}×</span>
          <input
            className="voice-rate"
            name="rate"
            type="range"
            min={MIN_RATE}
            max={MAX_RATE}
            step={0.05}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
          />
        </label>

        <label className="field-label">
          What to call it
          <input
            className="auth-input"
            name="assistantName"
            defaultValue={settings.assistantName}
            maxLength={40}
            placeholder="Manager"
          />
        </label>

        <label className="field-label voice-field-wide">
          Greeting <span className="muted">(left empty, it just opens)</span>
          <input
            className="auth-input"
            name="greeting"
            defaultValue={settings.greeting}
            maxLength={240}
            placeholder="Morning. What do you need?"
          />
        </label>

        <label className="voice-check">
          <input type="checkbox" name="speakReplies" defaultChecked={settings.speakReplies} />
          <span>
            <strong>Speak replies aloud</strong>
            <br />
            <span className="muted">Off means it answers in text unless you ask by voice.</span>
          </span>
        </label>

        <label className="voice-check">
          <input type="checkbox" name="handsFree" defaultChecked={settings.handsFree} />
          <span>
            <strong>Hands-free conversation</strong>
            <br />
            <span className="muted">
              Re-opens the microphone after each reply so you can keep talking without reaching for the button. It
              only listens once speaking has finished, so it never hears itself.
            </span>
          </span>
        </label>

        <div className="spend-form-submit">
          <button className="btn btn-primary" type="submit">Save</button>
        </div>
      </form>

      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        These are real voices installed on the device you are using, not an accent faked by instruction — so the list
        differs between your phone and your laptop, and one of them may be able to do an accent the other cannot.
        Whatever a voice resolves to here is exactly what the assistant will use.
      </p>
    </div>
  );
}
