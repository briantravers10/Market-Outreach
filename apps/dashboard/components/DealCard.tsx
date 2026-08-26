import Link from "next/link";
import type { PipedriveDeal } from "@market-outreach/core";
import { logCallAction, addNoteAction, moveStageAction } from "../lib/pipelineActions";

/**
 * One deal on the board, with the three things you actually do to a deal:
 * say you spoke to them, write down what was said, and move it along.
 *
 * Every control posts to Pipedrive. Nothing is recorded here, so pressing
 * these has exactly the same effect as doing it in the Pipedrive app — which
 * is the property that makes "are they in sync?" a question with no meaning.
 */
export function DealCard({
  deal,
  leadId,
  stages,
  canWrite,
}: {
  deal: PipedriveDeal;
  leadId: string | null;
  stages: { id: number; name: string }[];
  canWrite: boolean;
}) {
  const otherStages = stages.filter((s) => s.id !== deal.stageId);

  return (
    <div className="deal-card">
      <div className="deal-card-title">
        {leadId ? <Link href={`/leads/${leadId}`}>{deal.title}</Link> : deal.title}
      </div>

      {deal.updateTime && (
        <div className="deal-card-meta">Last touched {deal.updateTime.slice(0, 10)}</div>
      )}

      {!leadId && (
        <div className="deal-card-meta">
          {/* Deals made outside this system are shown but cannot be worked from
              here — the buttons key on our own lead id to find the deal. */}
          Not from this system
        </div>
      )}

      {canWrite && leadId && (
        <div className="deal-card-actions">
          <form action={logCallAction}>
            <input type="hidden" name="leadId" value={leadId} />
            <input type="hidden" name="subject" value="Called" />
            <input
              className="deal-card-input"
              name="note"
              placeholder="What was said…"
              aria-label="Call note"
            />
            <button className="btn btn-small" type="submit">Log call</button>
          </form>

          <form action={addNoteAction}>
            <input type="hidden" name="leadId" value={leadId} />
            <input className="deal-card-input" name="content" placeholder="Add a note…" aria-label="Note" />
            <button className="btn btn-small" type="submit">Save note</button>
          </form>

          {otherStages.length > 0 && (
            <form action={moveStageAction} className="deal-card-move">
              <input type="hidden" name="leadId" value={leadId} />
              <select name="stageId" className="deal-card-input" aria-label="Move to stage" defaultValue="">
                <option value="" disabled>Move to…</option>
                {otherStages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <button className="btn btn-small" type="submit">Move</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
