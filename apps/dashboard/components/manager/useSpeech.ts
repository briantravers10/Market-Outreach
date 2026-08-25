"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
}

export function useSpeech(onFinalTranscript: (text: string) => void): SpeechState {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [synthesisSupported, setSynthesisSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Held in a ref so the recognition callbacks always call the latest handler
  // without having to tear down and rebuild recognition on every render.
  const onFinalRef = useRef(onFinalTranscript);
  onFinalRef.current = onFinalTranscript;

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
    const recognition = recognitionRef.current;
    if (!recognition) {
      setError("This browser doesn't support voice input. Chrome, Edge or Safari do.");
      return;
    }
    // Talking over itself sounds broken and also feeds the assistant's own
    // voice back into the microphone.
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
    utterance.lang = "en-GB";
    utterance.rate = 1.02;
    utterance.pitch = 1;

    // Prefer a natural-sounding installed voice. This is the seam a paid,
    // higher-quality voice provider would replace later; the selection is
    // deliberately by name rather than hard-coded to one, because the installed
    // set differs per device and per OS.
    const preferred = ["Google UK English Male", "Daniel", "Google UK English Female", "Samantha"];
    const voices = window.speechSynthesis.getVoices();
    const chosen =
      voices.find((v) => preferred.includes(v.name)) ??
      voices.find((v) => v.lang?.startsWith("en-GB")) ??
      voices.find((v) => v.lang?.startsWith("en"));
    if (chosen) utterance.voice = chosen;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
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
  };
}
