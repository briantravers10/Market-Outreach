"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { findVoiceProfile, resolveVoice } from "@market-outreach/core/manager/voiceProfiles";

/**
 * Voice input and output, using the browser's own Web Speech API.
 *
 * Chosen over a paid speech service for V1 because it needs no API key, no
 * per-minute cost and no audio leaving the device — and because a voice feature
 * that can't be switched on isn't a voice feature. The tradeoff is real:
 * recognition support is uneven (Chrome, Edge and Safari have it; Firefox does
 * not), which is why `recognitionSupported` is reported honestly and the UI
 * falls back to typing rather than showing a dead microphone button.
 *
 * PRIVACY: the microphone is only ever opened by an explicit user action, and
 * `continuous` is false, so it stops on its own after an utterance. There is no
 * always-listening mode and no wake word. `startListening` is the single entry
 * point, so adding an opt-in wake word later means calling it from a detector —
 * not loosening anything here.
 */

// The API is still vendor-prefixed in most browsers and absent from the DOM
// typings, so it's reached through a narrow local interface rather than `any`.
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  >;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface SpeechState {
  recognitionSupported: boolean;
  synthesisSupported: boolean;
  listening: boolean;
  speaking: boolean;
  /** Live partial transcript while the user is still talking. */
  interim: string;
  error: string | null;
  startListening(): void;
  stopListening(): void;
  speak(text: string): void;
  stopSpeaking(): void;
  /**
   * Must be called synchronously from inside a tap/click handler.
   *
   * iOS Safari only permits speech that begins within a user gesture. Our reply
   * arrives after a server round-trip, which breaks that chain, so a later
   * speak() is silently dropped — it works on desktop and fails on iPad, with no
   * error either way. Speaking a silent utterance during the tap unlocks the
   * engine for the rest of the page's life, after which programmatic speech is
   * allowed.
   */
  primeVoice(): void;
}

export interface SpeechOptions {
  /** Which of the eight voice profiles to speak in. */
  voiceProfileId: string;
  rate: number;
  /**
   * Re-open the microphone once a reply has finished being spoken.
   *
   * This is what turns question-and-answer into conversation: without it every
   * turn costs a reach for the button. It only ever starts AFTER speech ends,
   * so the assistant is never listening to itself — the microphone and the
   * speaker are never open at the same time, which on a laptop speaker is the
   * difference between turn-taking and a feedback loop.
   */
  handsFree: boolean;
}

export function useSpeech(
  onFinalTranscript: (text: string) => void,
  options: SpeechOptions
): SpeechState {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [synthesisSupported, setSynthesisSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Held in a ref because primeVoice is defined below startListening.
  const primeVoiceRef = useRef<(() => void) | null>(null);
  // Held in a ref so the recognition callbacks always call the latest handler
  // without having to tear down and rebuild recognition on every render.
  const onFinalRef = useRef(onFinalTranscript);
  onFinalRef.current = onFinalTranscript;
  // Read inside callbacks that must not be rebuilt when a setting changes —
  // rebuilding recognition mid-conversation drops the microphone.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  /** Set while a reply is being spoken, so hands-free knows when to re-listen. */
  const resumeAfterSpeechRef = useRef(false);
  // speak() is defined above startListening but needs to call it when a
  // hands-free turn ends.
  const startListeningRef = useRef<(() => void) | null>(null);

  // Feature detection runs in an effect, not during render, so the server and
  // the first client render agree and hydration doesn't mismatch.
  useEffect(() => {
    setRecognitionSupported(getRecognitionCtor() !== null);
    setSynthesisSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = "en-GB";
    // Never continuous: the microphone closes itself after one utterance.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      let finalText = "";
      let partial = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += transcript;
        else partial += transcript;
      }
      setInterim(partial);
      if (finalText.trim()) {
        setInterim("");
        onFinalRef.current(finalText.trim());
      }
    };

    recognition.onerror = (event) => {
      // "aborted" and "no-speech" are ordinary outcomes of stopping or pausing,
      // not failures worth showing.
      if (event.error === "aborted" || event.error === "no-speech") {
        setListening(false);
        return;
      }
      setError(
        event.error === "not-allowed"
          ? "Microphone access was blocked. Allow it in your browser settings to use voice."
          : `Microphone error: ${event.error}`
      );
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      setInterim("");
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onstart = null;
      try {
        recognition.abort();
      } catch {
        // Already stopped — nothing to clean up.
      }
      recognitionRef.current = null;
    };
  }, []);

  const startListening = useCallback(() => {
    // This runs inside the tap, so it is the ideal moment to unlock playback for
    // the answer that will arrive later.
    primeVoiceRef.current?.();
    const recognition = recognitionRef.current;
    if (!recognition) {
      setError("This browser doesn't support voice input. Chrome, Edge or Safari do.");
      return;
    }
    /**
     * Barge-in: starting to speak cuts the assistant off mid-sentence.
     *
     * Waiting politely through a reply you have already heard enough of is the
     * single thing that makes a voice assistant feel like software rather than
     * a conversation. Cancelling here also stops the assistant's own voice
     * being fed back into the microphone.
     *
     * The interruption is deliberate, so the hands-free resumption is cleared
     * too — otherwise the microphone would be re-opened a second time when the
     * cancelled utterance's end event fires.
     */
    resumeAfterSpeechRef.current = false;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
    try {
      recognition.start();
    } catch {
      // start() throws if it is already running; that is not an error state.
    }
  }, []);

  startListeningRef.current = startListening;

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // Not running.
    }
    setListening(false);
    setInterim("");
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const clean = text
      // The replies are written for reading as well as speaking, so strip the
      // list markers rather than having them read out as "bullet".
      .replace(/^[•\-*]\s*/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);

    /**
     * The voice the owner actually chose, resolved against what this device
     * has. resolveVoice is the same pure function the settings screen uses, so
     * what is previewed there is what is heard here — and when the accent
     * cannot be honoured, both say so rather than only one of them.
     */
    const profile = findVoiceProfile(optionsRef.current.voiceProfileId);
    const installed = window.speechSynthesis.getVoices();
    const resolution = profile
      ? resolveVoice(profile, installed.map((v) => ({ name: v.name, lang: v.lang })))
      : null;
    const chosen = resolution?.voice
      ? installed.find((v) => v.name === resolution.voice?.name && v.lang === resolution.voice?.lang)
      : undefined;

    if (chosen) {
      utterance.voice = chosen;
      // Matching the language to the voice matters: leaving it at en-GB while
      // speaking through an en-IE voice makes some engines re-pick a voice of
      // their own and quietly undo the setting.
      utterance.lang = chosen.lang;
    } else {
      utterance.lang = profile?.langs[0] ?? "en-GB";
    }

    utterance.rate = optionsRef.current.rate;
    utterance.pitch = 1;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => {
      setSpeaking(false);
      // Hands-free: hand the turn straight back rather than making the owner
      // reach for the button. Started only once speech has ENDED, so the
      // microphone and the speaker are never open together.
      if (resumeAfterSpeechRef.current && optionsRef.current.handsFree) {
        resumeAfterSpeechRef.current = false;
        // A beat, so the tail of the utterance is not caught by the microphone.
        window.setTimeout(() => startListeningRef.current?.(), 250);
      }
    };
    utterance.onerror = () => {
      setSpeaking(false);
      resumeAfterSpeechRef.current = false;
    };
    resumeAfterSpeechRef.current = true;
    window.speechSynthesis.speak(utterance);
  }, []);

  // Set once the engine has been unlocked by a gesture, so priming is a no-op
  // afterwards rather than a stutter before every reply.
  const primedRef = useRef(false);

  const primeVoice = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    // Safari can leave the queue paused after a period of inactivity.
    try {
      window.speechSynthesis.resume();
    } catch {
      // Not paused.
    }
    if (primedRef.current) return;
    try {
      const silent = new SpeechSynthesisUtterance("");
      silent.volume = 0;
      window.speechSynthesis.speak(silent);
      // Also forces the voice list to populate, which on iOS is empty until
      // synthesis has been touched at least once.
      window.speechSynthesis.getVoices();
      primedRef.current = true;
    } catch {
      // If priming throws, speaking later will simply not happen; nothing to recover.
    }
  }, []);

  primeVoiceRef.current = primeVoice;

  const stopSpeaking = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    // Silencing it deliberately must not then hand the turn back — "stop" means
    // stop, not "stop and start listening to me".
    resumeAfterSpeechRef.current = false;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  // Leaving the page mid-sentence should not keep talking.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    recognitionSupported,
    synthesisSupported,
    listening,
    speaking,
    interim,
    error,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    primeVoice,
  };
}
