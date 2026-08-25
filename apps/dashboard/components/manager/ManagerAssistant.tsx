"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  approveManagerAction,
  loadConversation,
  rejectManagerAction,
  sendManagerMessage,
  type ChatReply,
} from "../../lib/managerActions";
import { useSpeech } from "./useSpeech";

/**
 * The floating Manager assistant.
 *
 * States the owner can see at a glance, because a voice interface that doesn't
 * show what it's doing feels broken: idle, listening, thinking, speaking. Each
 * is driven by real state — `listening` comes from the recognition engine's own
 * events, `speaking` from the synthesis engine's, `thinking` from the in-flight
 * server action — never from a timer pretending.
 */

interface Turn {
  id: string;
  role: "owner" | "manager" | "system";
  content: string;
  pendingActionId?: string | null;
  pendingSummary?: string | null;
  /** Set once the owner answers, so the buttons can be replaced by the outcome. */
  resolved?: "approved" | "rejected";
}

type Status = "idle" | "listening" | "thinking" | "speaking";

let turnCounter = 0;
const nextId = () => `turn-${(turnCounter += 1)}`;

export function ManagerAssistant({ demoMode }: { demoMode: boolean }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [brainNote, setBrainNote] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Read inside callbacks that must not be rebuilt when the toggle changes.
  const voiceRepliesRef = useRef(voiceReplies);
  voiceRepliesRef.current = voiceReplies;

  const applyReply = useCallback((reply: ChatReply, speak: (t: string) => void) => {
    setConversationId(reply.conversationId || undefined);
    setTurns((prev) => [
      ...prev,
      {
        id: nextId(),
        role: "manager",
        content: reply.reply,
        pendingActionId: reply.pendingActionId,
        pendingSummary: reply.pendingSummary,
      },
    ]);
    if (!reply.usingLlm && brainNote === null) {
      setBrainNote(
        "No language model is connected, so I match your words against known request shapes. Ask me what I can do."
      );
    }
    if (voiceRepliesRef.current) speak(reply.reply);
  }, [brainNote]);

  const submit = useCallback(
    async (text: string, speak: (t: string) => void) => {
      const trimmed = text.trim();
      if (!trimmed || thinking) return;

      setTurns((prev) => [...prev, { id: nextId(), role: "owner", content: trimmed }]);
      setInput("");
      setThinking(true);
      try {
        const reply = await sendManagerMessage(trimmed, conversationId);
        applyReply(reply, speak);
      } catch {
        setTurns((prev) => [
          ...prev,
          { id: nextId(), role: "system", content: "I couldn't reach the server. Try again." },
        ]);
      } finally {
        setThinking(false);
      }
    },
    [conversationId, thinking, applyReply]
  );

  // Declared before useSpeech so the recognition callback can call it, and kept
  // in a ref so useSpeech never needs rebuilding when `submit` changes.
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const speech = useSpeech(
    useCallback((transcript: string) => {
      // A spoken question always gets a spoken answer — otherwise the reply is
      // silent and the owner is left staring at the screen they were avoiding.
      setVoiceReplies(true);
      voiceRepliesRef.current = true;
      void submitRef.current(transcript, speechRef.current?.speak ?? (() => {}));
    }, [])
  );
  const speechRef = useRef(speech);
  speechRef.current = speech;

  const status: Status = speech.listening
    ? "listening"
    : thinking
      ? "thinking"
      : speech.speaking
        ? "speaking"
        : "idle";

  // Keep the newest turn in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, thinking, speech.interim]);

  // Resume the last conversation rather than starting fresh each time the panel
  // is opened — the transcript is the point.
  useEffect(() => {
    if (!open || turns.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const existing = conversationId ? await loadConversation(conversationId) : [];
        if (cancelled || existing.length === 0) return;
        setTurns(
          existing
            .filter((m) => m.role === "owner" || m.role === "manager")
            .slice(-20)
            .map((m) => ({ id: m.id, role: m.role as "owner" | "manager", content: m.content }))
        );
      } catch {
        // A failed history load shouldn't block a new conversation.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, turns.length]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = useCallback(() => {
    speech.stopListening();
    speech.stopSpeaking();
    setOpen(false);
  }, [speech]);

  // Escape closes, matching every other panel on the web.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  async function decide(turnId: string, actionId: string, approve: boolean) {
    setThinking(true);
    try {
      const reply = approve ? await approveManagerAction(actionId) : await rejectManagerAction(actionId);
      setTurns((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, resolved: approve ? "approved" : "rejected" } : t))
      );
      applyReply(reply, speech.speak);
    } finally {
      setThinking(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="assistant-fab"
        onClick={() => setOpen(true)}
        aria-label="Open the Manager"
        title="Manager"
      >
        <ManagerGlyph />
      </button>
    );
  }

  return (
    <section className="assistant-panel" role="dialog" aria-label="Manager assistant">
      <header className="assistant-head">
        <div className="assistant-title">
          <ManagerGlyph />
          <div>
            <strong>Manager</strong>
            <span className={`assistant-state assistant-state-${status}`}>
              <span className="assistant-state-dot" />
              {status === "listening"
                ? "Listening"
                : status === "thinking"
                  ? "Working on it"
                  : status === "speaking"
                    ? "Speaking"
                    : "Ready"}
            </span>
          </div>
        </div>
        <div className="assistant-head-actions">
          {speech.synthesisSupported && (
            <button
              type="button"
              className={`assistant-toggle ${voiceReplies ? "on" : ""}`}
              onClick={() => {
                if (voiceReplies) speech.stopSpeaking();
                setVoiceReplies(!voiceReplies);
              }}
              title={voiceReplies ? "Spoken replies on" : "Spoken replies off"}
              aria-pressed={voiceReplies}
            >
              {voiceReplies ? "Voice on" : "Voice off"}
            </button>
          )}
          <button type="button" className="assistant-close" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
      </header>

      <div className="assistant-transcript" ref={scrollRef}>
        {turns.length === 0 && (
          <div className="assistant-empty">
            <p>Ask me for a briefing, what the team is doing, or tell me what to have them work on.</p>
            <div className="assistant-suggestions">
              {[
                "Give me my briefing",
                "What is everyone doing?",
                "Show me the best leads",
                "Tell the Scout to stop including chains",
              ].map((s) => (
                <button key={s} type="button" onClick={() => void submit(s, speech.speak)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className={`assistant-turn assistant-turn-${turn.role}`}>
            <div className="assistant-bubble">
              {turn.content.split("\n").map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            {turn.pendingActionId && !turn.resolved && (
              <div className="assistant-approve">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={thinking}
                  onClick={() => void decide(turn.id, turn.pendingActionId!, true)}
                >
                  Yes, do it
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={thinking}
                  onClick={() => void decide(turn.id, turn.pendingActionId!, false)}
                >
                  No
                </button>
              </div>
            )}
            {turn.resolved && (
              <div className="assistant-resolved">
                {turn.resolved === "approved" ? "You approved this." : "You declined this."}
              </div>
            )}
          </div>
        ))}

        {speech.interim && (
          <div className="assistant-turn assistant-turn-owner">
            <div className="assistant-bubble assistant-bubble-interim">{speech.interim}</div>
          </div>
        )}

        {thinking && (
          <div className="assistant-turn assistant-turn-manager">
            <div className="assistant-bubble assistant-thinking">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      {brainNote && <div className="assistant-note">{brainNote}</div>}
      {speech.error && <div className="assistant-note assistant-note-warn">{speech.error}</div>}
      {demoMode && (
        <div className="assistant-note">
          Read-only demo: I can look things up, but I can&apos;t change anything here.
        </div>
      )}

      <form
        className="assistant-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(input, speech.speak);
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(input, speech.speak);
            }
          }}
          placeholder="Ask the Manager…"
          rows={1}
          aria-label="Message the Manager"
        />

        {speech.recognitionSupported ? (
          <button
            type="button"
            className={`assistant-mic ${speech.listening ? "active" : ""}`}
            onClick={() => (speech.listening ? speech.stopListening() : speech.startListening())}
            aria-label={speech.listening ? "Stop listening" : "Start listening"}
            title={speech.listening ? "Stop listening" : "Speak to the Manager"}
          >
            {speech.listening ? <StopGlyph /> : <MicGlyph />}
          </button>
        ) : (
          <span className="assistant-mic-missing" title="Voice input needs Chrome, Edge or Safari">
            <MicGlyph />
          </span>
        )}

        {speech.speaking ? (
          <button type="button" className="btn btn-ghost" onClick={speech.stopSpeaking}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={thinking || !input.trim()}>
            Send
          </button>
        )}
      </form>
    </section>
  );
}

// --- glyphs ---------------------------------------------------------------

function ManagerGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="assistant-glyph" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.5 10.5l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" />
    </svg>
  );
}
