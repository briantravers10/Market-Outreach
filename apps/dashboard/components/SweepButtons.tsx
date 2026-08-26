"use client";

import { useFormStatus } from "react-dom";

/**
 * The sweep's submit buttons, with a working state.
 *
 * A plain form post here reads as a broken button: the action fetches real
 * websites and takes the better part of half a minute, during which the page
 * sits completely still. The owner pressed it, saw nothing move, and
 * reasonably concluded nothing had happened — when in fact it was the only
 * thing making progress at the time.
 */
export function SweepButtons() {
  const { pending } = useFormStatus();

  return (
    <>
      <div className="bulk-push-actions">
        <button className="btn btn-primary" type="submit" name="mode" value="recheck" disabled={pending}>
          {pending ? "Reading sites…" : "Re-read a batch"}
        </button>
        <button className="btn" type="submit" name="mode" value="new" disabled={pending}>
          Read unchecked
        </button>
      </div>
      {pending && (
        <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
          Visiting each business&apos;s website and re-scoring them. This takes about half a minute — the page will
          update itself when it finishes. Results are saved as it goes, so nothing is lost if you navigate away.
        </p>
      )}
    </>
  );
}
