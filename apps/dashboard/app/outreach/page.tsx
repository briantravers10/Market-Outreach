export default function OutreachPage() {
  return (
    <div>
      <div className="page-header">
        <h1>Outreach</h1>
        <p>Status: DISABLED</p>
      </div>
      <div className="panel">
        <p className="disabled-banner">
          No Outreach Agent is active and no email/SMS provider is wired up — Resend and Twilio aren't even installed
          as dependencies in this codebase. This system never contacts a business, sends email, sends SMS, or submits
          a contact form. Outreach is future expansion, explicitly out of scope until live prospecting is authorized.
        </p>
      </div>
    </div>
  );
}
