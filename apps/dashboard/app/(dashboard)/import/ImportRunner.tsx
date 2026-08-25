"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Drives the chunked import endpoint.
 *
 * The loop lives in the browser rather than the server because a serverless
 * function cannot run for the twenty-odd minutes a statewide import takes, and
 * a background worker would be a whole piece of infrastructure to own. Here,
 * the page holds the loop, each request is short, and closing the tab stops it
 * without corrupting anything — the next run resumes from where the count got to.
 */
export function ImportRunner({ source, label, expected }: { source: string; label: string; expected: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const run = useCallback(async () => {
    cancelled.current = false;
    setRunning(true);
    setError(null);
    setMessage(null);
    let offset = 0;
    let total = 0;

    try {
      for (;;) {
        if (cancelled.current) {
          setMessage(`Stopped at ${total.toLocaleString()} businesses. Press Import again to carry on.`);
          break;
        }
        const response = await fetch("/api/admin/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, offset, count: 2000 }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Import failed with status ${response.status}`);
        }
        const result = (await response.json()) as {
          imported: number;
          updated: number;
          nextOffset: number;
          done: boolean;
        };
        total += result.imported + result.updated;
        offset = result.nextOffset;
        setDone(total);
        if (result.done) {
          setMessage(`Finished. ${total.toLocaleString()} businesses imported and scored.`);
          break;
        }
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  }, [router, source]);

  const pct = expected > 0 ? Math.min(100, Math.round((done / expected) * 100)) : 0;

  return (
    <div style={{ display: "grid", gap: "0.9rem" }}>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn" onClick={run} disabled={running}>
          {running ? "Importing…" : `Import ${label}`}
        </button>
        {running && (
          <button className="btn btn-secondary" onClick={() => { cancelled.current = true; }}>
            Stop
          </button>
        )}
        {(running || done > 0) && (
          <span className="muted">
            {done.toLocaleString()} of about {expected.toLocaleString()} ({pct}%)
          </span>
        )}
      </div>

      {(running || done > 0) && (
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{ height: 8, background: "var(--surface-2, #e5e7eb)", borderRadius: 4, overflow: "hidden" }}
        >
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent, #0d5b52)", transition: "width 200ms ease" }} />
        </div>
      )}

      {message && <p className="muted" style={{ margin: 0 }}>{message}</p>}
      {error && <p style={{ margin: 0, color: "var(--danger, #b91c1c)" }}>{error}</p>}
      <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
        Safe to run more than once — businesses are matched on their source id, so a second run refreshes what
        changed rather than creating duplicates. Leave this page open while it runs.
      </p>
    </div>
  );
}
