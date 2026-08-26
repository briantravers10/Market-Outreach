import Link from "next/link";
import { addLeadToCrmAction } from "../lib/pipelineActions";

/**
 * The one action that turns a researched lead into something you are working.
 *
 * Pressing it creates a real Organization, Person and Deal in Pipedrive — the
 * same records you would see opening the Pipedrive app on your phone — and
 * drops the lead out of the working list so it cannot be picked up twice.
 *
 * It states plainly which of the two switches is missing when it cannot write,
 * because "nothing happened and I don't know why" is the failure this project
 * has already paid for twice.
 */
export function AddToCrmPanel({
  leadId,
  businessName,
  alreadyInCrm,
  dealId,
  live,
}: {
  leadId: string;
  businessName: string;
  alreadyInCrm: boolean;
  dealId: string | null;
  live: boolean;
}) {
  if (alreadyInCrm && dealId) {
    return (
      <div className="panel">
        <h2>In your pipeline</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
          {businessName} is in Pipedrive as deal <code>{dealId}</code>. Work it from the{" "}
          <Link href="/pipeline">Pipeline board</Link> — log calls, add notes and move it along there, and the
          changes land in Pipedrive itself.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Work this lead</h2>

      {alreadyInCrm && !dealId && (
        <p className="muted" style={{ marginTop: 0 }}>
          This was pushed while Pipedrive was in dry run, so the records were built but never sent. Pressing the
          button again sends them for real.
        </p>
      )}

      <p className="muted" style={{ marginTop: alreadyInCrm && !dealId ? undefined : 0 }}>
        Creates an Organization, Person and Deal in Pipedrive, and takes {businessName} out of your leads list so it
        does not come round again.
      </p>

      <form action={addLeadToCrmAction}>
        <input type="hidden" name="leadId" value={leadId} />
        <button className="btn btn-primary" type="submit">
          Add to Pipedrive
        </button>
      </form>

      {!live && (
        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
          <strong>Nothing will reach Pipedrive yet.</strong> Writing needs <code>PIPEDRIVE_API_TOKEN</code> and{" "}
          <code>PIPEDRIVE_LIVE_SYNC=1</code>, both set for Production, then a redeploy. Until then this records what
          would have been sent. <Link href="/crm">Check which switch is missing</Link>.
        </p>
      )}
    </div>
  );
}
