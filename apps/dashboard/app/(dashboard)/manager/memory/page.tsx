import { getAgentConfigs } from "@market-outreach/core";
import { getRepos } from "../../../../lib/data";

export const dynamic = "force-dynamic";

/**
 * Conversation history — the Manager's actual memory.
 *
 * This page exists to make a specific point checkable: nothing here depends on
 * a language model recalling anything. Every word was written to the database
 * as it was said, and this is a straight read of those rows.
 */
export default async function MemoryPage() {
  const repos = getRepos();
  const conversations = await repos.conversations.list(25);
  const names = new Map(getAgentConfigs().map((a) => [a.id, a.name]));

  if (conversations.length === 0) {
    return (
      <div className="panel">
        <p className="empty-state">
          No conversations yet. Everything you say to the Manager is recorded here permanently.
        </p>
      </div>
    );
  }

  const transcripts = await Promise.all(
    conversations.slice(0, 10).map(async (c) => ({
      conversation: c,
      messages: await repos.conversations.listMessages(c.id, 100),
    }))
  );

  return (
    <div>
      <div className="panel">
        <h2>How this works</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
          Every message is written to the database as it happens, along with which capability it
          triggered. Asking &ldquo;what did I tell the Scout last week&rdquo; queries these rows — it does
          not ask a model to remember.
        </p>
      </div>

      {transcripts.map(({ conversation, messages }) => (
        <div className="panel" key={conversation.id}>
          <h2>
            {new Date(conversation.startedAt).toLocaleString("en-GB")}
            {conversation.focusAgentId && (
              <small> · focused on the {names.get(conversation.focusAgentId) ?? conversation.focusAgentId}</small>
            )}
          </h2>
          <div className="timeline">
            {messages.map((m) => (
              <div className="timeline-row" key={m.id}>
                <div className="timeline-time">
                  {new Date(m.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div className="timeline-body">
                  <span className="timeline-actor">{m.role === "owner" ? "You" : "Manager"}</span>{" "}
                  {m.content}
                  {m.intent && (
                    <div className="instruction-meta">
                      resolved to: {m.intent}
                      {m.brain ? ` · via ${m.brain}` : ""}
                      {m.toolCalls.length > 0 && ` · ran ${m.toolCalls.map((t) => t.tool).join(", ")}`}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
