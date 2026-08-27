import { KNOWN_BOOKING_PROVIDERS, assessReadiness, describeHoldReason, type Lead } from "@market-outreach/core";
import { verifyLeadAction } from "../lib/verificationActions";

/**
 * Recording what you found when you looked at a business yourself.
 *
 * Exists because the automated research cannot settle every lead and never
 * will — a business with no website and no marketplace listing is invisible to
 * all of it, and the only way to know is for someone to look. That someone may
 * be paid by the day, which sets the two properties this panel has to make
 * obvious: the answer is attributed, and once given it is final. No sweep
 * revisits a business a person has checked.
 *
 * Both questions may be left blank. Someone who established the website but
 * not the booking has still learned something worth keeping, and forcing a
 * guess on the other field would be worse than an honest gap.
 */
export function VerifyPanel({ lead, returnTo }: { lead: Lead; returnTo: string }) {
  const readiness = assessReadiness(lead);
  const alreadyChecked = Boolean(lead.verifiedAt);

  return (
    <div className="panel">
      <h2>
        Check this one yourself
        {alreadyChecked && <small>already checked</small>}
      </h2>

      {alreadyChecked ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Checked by <strong>{lead.verifiedBy}</strong> on {lead.verifiedAt?.slice(0, 10)}. Nothing automated will
          overwrite this. Filling the form in again replaces the answer and records you as the one who changed it.
        </p>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>
          {readiness.ready
            ? "This one is already researched, but if you find something different, what you enter wins."
            : `Held because: ${describeHoldReason(readiness.reason!).toLowerCase()}. Answering here settles it and puts the lead on your call list — permanently. No sweep will revisit it.`}
        </p>
      )}

      <form action={verifyLeadAction} className="verify-form">
        <input type="hidden" name="leadId" value={lead.id} />
        <input type="hidden" name="returnTo" value={returnTo} />

        <label className="field-label">
          Do they have a website?
          <select className="auth-input" name="hasWebsite" defaultValue="">
            <option value="">— leave as it is —</option>
            <option value="yes">Yes</option>
            <option value="no">No, none at all</option>
          </select>
        </label>

        <label className="field-label">
          Website address <span className="muted">(if you found one)</span>
          <input
            className="auth-input"
            name="website"
            inputMode="url"
            placeholder="https://…"
            defaultValue={lead.website ?? ""}
          />
        </label>

        <label className="field-label">
          Can customers book online?
          <select className="auth-input" name="bookingProvider" defaultValue="">
            <option value="">— leave as it is —</option>
            <option value="none">No — phone or walk-in only</option>
            {KNOWN_BOOKING_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                Yes — {provider}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label verify-form-wide">
          What did you see? <span className="muted">(optional)</span>
          <input
            className="auth-input"
            name="note"
            maxLength={500}
            placeholder="Rang them — they take bookings by phone. No Booksy listing."
          />
        </label>

        <div className="verify-form-submit">
          <button className="btn btn-primary" type="submit">
            Save what I found
          </button>
        </div>
      </form>

      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        Leave a question on &ldquo;leave as it is&rdquo; if you did not establish it — a guess recorded here is worse
        than a gap, because everything downstream will treat it as fact. &ldquo;No online booking&rdquo; is the
        valuable answer and the one that needs a person: it is a negative, and negatives are what the automated
        research is worst at proving.
      </p>
    </div>
  );
}
