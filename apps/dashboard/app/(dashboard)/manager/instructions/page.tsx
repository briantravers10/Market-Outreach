import { describeEffect, getAgentConfigs } from "@market-outreach/core";
import { getRepos } from "../../../../lib/data";

export const dynamic = "force-dynamic";

/**
 * Every instruction ever given, active and historical.
 *
 * Enforced vs advisory is the most important thing on this page, so it's a
 * badge on every row rather than a footnote — the owner needs to know at a
 * glance which of their rules are actually changing behaviour.
 */
export default async function InstructionsPage() {
  const repos = getRepos();
  const all = await repos.instructions.list({ limit: 300 });
  const names = new Map(getAgentConfigs().map((a) => [a.id, a.name]));

  const active = all.filter((i) => i.status === "active");
  const history = all.filter((i) => i.status !== "active");

  function card(i: (typeof all)[number]) {
    return (
      <div className="instruction-card" key={i.id}>
        <div className="instruction-card-head">
          <div className="instruction-text">{i.instruction}</div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <span className={`tag tag-${i.scope}`}>{i.scope}</span>
            <span className={`tag ${i.effect ? "tag-enforced" : "tag-advisory"}`}>
              {i.effect ? "Enforced" : "Advisory"}
            </span>
            {i.status !== "active" && <span className="tag tag-inactive">{i.status}</span>}
          </div>
        </div>
        <div className="instruction-effect">{describeEffect(i.effect)}</div>
        {i.rationale && <div className="instruction-effect">Reason given: {i.rationale}</div>}
        <div className="instruction-meta">
          For the {names.get(i.agentId) ?? i.agentId} · v{i.version} · given{" "}
          {new Date(i.createdAt).toLocaleString("en-GB")}
          {i.expiresAt && ` · expires ${new Date(i.expiresAt).toLocaleString("en-GB")}`}
          {i.revokedAt && ` · revoked ${new Date(i.revokedAt).toLocaleString("en-GB")}`}
          {i.supersededById && " · replaced by a later instruction"}
          {i.supersedesId && " · replaced an earlier instruction"}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <h2>In force <small>({active.length})</small></h2>
        {active.length === 0 ? (
          <p className="empty-state">
            No standing instructions. Tell the Manager something like &ldquo;from now on, don&apos;t
            include national chains&rdquo; and it will appear here.
          </p>
        ) : (
          active.map(card)
        )}
      </div>

      {history.length > 0 && (
        <div className="panel">
          <h2>History <small>({history.length})</small></h2>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
            Nothing is ever deleted — a revoked or replaced instruction stays here so you can see what
            the rules were at any point in the past.
          </p>
          {history.map(card)}
        </div>
      )}
    </div>
  );
}
