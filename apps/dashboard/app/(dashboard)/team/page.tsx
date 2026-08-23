import { summarizeAllAgents } from "@market-outreach/core";
import { getRepos } from "../../../lib/data";
import { AgentCard } from "../../../components/AgentCard";
import { LiveRefresh } from "../../../components/LiveRefresh";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const repos = getRepos();
  const agents = await summarizeAllAgents(repos.agentActivity, repos.humanReview);

  return (
    <div>
      <LiveRefresh />
      <div className="page-header">
        <h1>Team</h1>
        <p>Your AI prospecting team. Click an agent to see what it's working on and give it direct instructions.</p>
      </div>

      <div className="agent-grid">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  );
}
