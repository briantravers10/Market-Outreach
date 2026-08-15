export default function CrmPage() {
  return (
    <div>
      <div className="page-header">
        <h1>CRM</h1>
        <p>Status: DISABLED</p>
      </div>
      <div className="panel">
        <p className="disabled-banner">
          No third-party CRM is connected, and no CRM Agent is active this phase. Once a campaign qualifies leads,
          each Lead Detail page shows a preview of what a future CRM hand-off would look like — nothing syncs live.
          Building this out is future expansion, not part of this skeleton.
        </p>
      </div>
    </div>
  );
}
