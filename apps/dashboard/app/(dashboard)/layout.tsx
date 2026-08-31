import { Sidebar } from "../../components/Sidebar";
import { ManagerAssistant } from "../../components/manager/ManagerAssistant";
import { isDemoMode } from "../../lib/demo";
import { getIntegrationStatus, getVoiceSettings } from "../../lib/data";
import { getCurrentUser } from "../../lib/authActions";
import { getAuthConfig } from "../../lib/authConfig";

/**
 * Chrome for the authenticated dashboard. Auth pages live in the (auth) group
 * and deliberately don't get any of this.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const authConfig = getAuthConfig();
  const integrations = getIntegrationStatus();
  const voiceSettings = await getVoiceSettings();
  const canSend = integrations.email.ready || integrations.sms.ready;

  return (
    <>
      {/*
        This banner has one job: make sure nobody mistakes what they are looking
        at. It used to say the data was synthetic, which stopped being true the
        moment the Overture import ran — and a page showing a real person's
        mobile number under a banner calling it test data is worse than no
        banner at all. So it now reads the deployment's actual state rather
        than asserting a phase.
      */}
      <div className="safety-banner">
        {isDemoMode ? (
          <>
            <strong>Public demo</strong> — every business here is invented, and the snapshot never changes.
            Controls are disabled.
          </>
        ) : canSend ? (
          /*
            The banner has to change the moment sending becomes possible. It
            previously stated flatly that "outreach is disabled in code" — true
            when written, and a dangerous thing to keep asserting once a Resend
            or Twilio key exists, because it invites treating a real send as a
            rehearsal.
          */
          <>
            <strong>Live outreach is possible</strong> — these are real businesses and real contact details.
            {integrations.email.ready && integrations.sms.ready
              ? " Email and SMS are both configured"
              : integrations.email.ready
                ? " Email is configured"
                : " SMS is configured"}
            , so anything you approve actually reaches the business. Nothing sends without your approval.
          </>
        ) : (
          <>
            <strong>Research only</strong> — these are real businesses and real contact details, from published
            open data. Nothing here can contact them: no email or SMS provider is configured.
            {integrations.crm.live && " Pipedrive sync IS live, so pushed leads reach your real CRM."}
          </>
        )}
        {!authConfig.enabled && " No login is configured on this deployment."}
      </div>
      <div className="layout">
        <Sidebar
          userEmail={user?.email ?? null}
          integrations={{
            crm: integrations.crm,
            outreachTag: integrations.outreachTag,
            outreachLive: canSend,
          }}
        />
        <main className="content">{children}</main>
      </div>
      {/* Available on every dashboard page — the Manager is the primary interface,
          not a page you have to navigate to. */}
      <ManagerAssistant voiceSettings={voiceSettings} demoMode={isDemoMode} />
    </>
  );
}
