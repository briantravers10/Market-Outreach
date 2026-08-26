import Link from "next/link";
import { PipedriveReader, describePipedriveMode } from "@market-outreach/core";
import { getRepos } from "../../../lib/data";
import { DealCard } from "../../../components/DealCard";

export const dynamic = "force-dynamic";

/**
 * The board, read live from Pipedrive on every load.
 *
 * There is deliberately no local copy of a deal. Pipedrive is the single
 * record of the conversation; this page is a window onto it. That means it is
 * never stale, it can never disagree with the Pipedrive app on your phone, and
 * there is no sync job that can quietly fall behind — the three failure modes
 * a mirrored copy would have introduced.
 *
 * The cost is that this page needs Pipedrive to answer. When it cannot, it says
 * so plainly instead of showing an empty board that looks like "no deals".
 */
export default async function PipelinePage() {
  const mode = describePipedriveMode();
  const reader = new PipedriveReader();

  if (!reader.configured) {
    return (
      <div>
        <div className="page-header">
          <h1>Pipeline</h1>
          <p>Your live deal board, read straight from Pipedrive.</p>
        </div>
        <div className="panel">
          <h2>Not connected yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Set <code>PIPEDRIVE_API_TOKEN</code> in Vercel and redeploy, then this becomes your working board.
          </p>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            Reading needs only the token. <strong>Writing</strong> — adding leads, logging calls — also needs{" "}
            <code>PIPEDRIVE_LIVE_SYNC=1</code>, so a token on its own can never start creating records in your real
            CRM by accident. <Link href="/crm">Connection details</Link>.
          </p>
        </div>
      </div>
    );
  }

  let stages: { id: number; name: string; order: number; pipelineId: number }[] = [];
  let deals: Awaited<ReturnType<PipedriveReader["listOpenDeals"]>> = [];
  let error: string | null = null;

  try {
    [stages, deals] = await Promise.all([reader.listStages(), reader.listOpenDeals()]);
  } catch (caught) {
    // A CRM outage must read as an outage. An empty board here would be a lie
    // that costs a day of "why has everything disappeared".
    error = caught instanceof Error ? caught.message : String(caught);
  }

  // Only the pipeline the deals actually live in — an account with several
  // boards would otherwise render every column of every board in one row.
  const activePipelineId = deals.find((d) => d.stageId !== null)
    ? stages.find((s) => s.id === deals.find((d) => d.stageId !== null)?.stageId)?.pipelineId
    : stages[0]?.pipelineId;
  const columns = stages.filter((s) => s.pipelineId === activePipelineId);

  // Which lead each deal came from, so a card can link back to its research.
  const crmRecords = await getRepos().crm.list();
  const leadIdByDealId = new Map(
    crmRecords.filter((r) => r.externalDealId).map((r) => [r.externalDealId as string, r.leadId])
  );

  return (
    <div>
      <div className="page-header">
        <h1>Pipeline</h1>
        <p>
          Live from Pipedrive — there is no second copy, so this and the Pipedrive app always agree. Anything you
          do here happens in Pipedrive itself.
        </p>
      </div>

      {error && (
        <div className="panel">
          <h2>Pipedrive did not answer</h2>
          <p className="muted" style={{ marginTop: 0 }}>{error}</p>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            Nothing has been lost — this page holds no data of its own. Reload once Pipedrive is reachable.
          </p>
        </div>
      )}

      {!error && !mode.live && (
        <div className="auth-notice" style={{ marginBottom: 16 }}>
          <p style={{ margin: 0 }}>
            <strong>Read-only.</strong> {mode.explanation} You can see the board, but the buttons on each deal will
            not write until <code>PIPEDRIVE_LIVE_SYNC=1</code> is set.
          </p>
        </div>
      )}

      {!error && columns.length === 0 && (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Pipedrive answered, but this account has no pipeline stages yet. Create a pipeline in Pipedrive and the
            board will appear here.
          </p>
        </div>
      )}

      {!error && columns.length > 0 && (
        <div className="pipeline-board">
          {columns.map((stage) => {
            const inStage = deals.filter((d) => d.stageId === stage.id);
            return (
              <div className="pipeline-column" key={stage.id}>
                <div className="pipeline-column-head">
                  <span>{stage.name}</span>
                  <span className="lead-tab-count">{inStage.length}</span>
                </div>
                {inStage.length === 0 && <p className="empty-state" style={{ fontSize: 12 }}>Nothing here.</p>}
                {inStage.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    leadId={deal.id ? leadIdByDealId.get(String(deal.id)) ?? null : null}
                    stages={columns}
                    canWrite={mode.live}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
