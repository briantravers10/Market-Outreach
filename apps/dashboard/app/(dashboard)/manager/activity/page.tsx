import { getAgentConfigs } from "@market-outreach/core";
import { getRepos } from "../../../../lib/data";

export const dynamic = "force-dynamic";

/**
 * Company activity log — one readable timeline of everything that happened,
 * merging what the owner asked for with what the employees actually did.
 *
 * Both streams are shown together deliberately: "I told the Scout to exclude
 * chains" and "the Scout excluded 4 candidates" only make sense next to each
 * other.
 */
export default async function ManagerActivityPage() {
  const repos = getRepos();
  const [activity, actions, messages] = await Promise.all([
    repos.agentActivity.list({ limit: 250 }),
    repos.managerActions.list({ limit: 150 }),
    repos.conversations.searchMessages({ limit: 150 }),
  ]);

  const names = new Map(getAgentConfigs().map((a) => [a.id, a.name]));

  type Entry = { at: string; actor: string; text: string; level?: "info" | "error" };
  const entries: Entry[] = [
    ...messages
      .filter((m) => m.role === "owner")
      .map((m) => ({ at: m.createdAt, actor: "You", text: `asked: "${m.content}"` })),
    ...actions
      .filter((a) => a.status !== "running")
      .map((a) => ({
        at: a.decidedAt ?? a.finishedAt ?? a.requestedAt,
        actor: "Manager",
        text:
          a.status === "rejected"
            ? `declined by you: ${a.intentSummary}`
            : a.status === "pending_approval"
              ? `asked permission: ${a.intentSummary}`
              : a.status === "failed"
                ? `failed: ${a.intentSummary}${a.error ? ` (${a.error})` : ""}`
                : a.intentSummary,
        level: a.status === "failed" ? ("error" as const) : ("info" as const),
      })),
    ...activity.map((a) => ({
      at: a.createdAt,
      actor: names.get(a.agentId) ?? a.agentId,
      text: a.summary,
      level: a.level === "error" ? ("error" as const) : ("info" as const),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  // Grouped by day so a long history stays scannable.
  const byDay = new Map<string, Entry[]>();
  for (const entry of entries.slice(0, 300)) {
    const day = new Date(entry.at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(entry);
  }

  if (entries.length === 0) {
    return (
      <div className="panel">
        <p className="empty-state">Nothing has happened yet. Ask the Manager to get the team started.</p>
      </div>
    );
  }

  return (
    <div>
      {[...byDay.entries()].map(([day, dayEntries]) => (
        <div className="panel" key={day}>
          <h2>{day}</h2>
          <div className="timeline">
            {dayEntries.map((entry, i) => (
              <div className={`timeline-row ${entry.level === "error" ? "timeline-row-error" : ""}`} key={i}>
                <div className="timeline-time">
                  {new Date(entry.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div className="timeline-body">
                  <span className="timeline-actor">{entry.actor}</span> {entry.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
