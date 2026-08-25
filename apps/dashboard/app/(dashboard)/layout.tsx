import { Sidebar } from "../../components/Sidebar";
import { ManagerAssistant } from "../../components/manager/ManagerAssistant";
import { isDemoMode } from "../../lib/demo";
import { getCurrentUser } from "../../lib/authActions";
import { getAuthConfig } from "../../lib/authConfig";

/**
 * Chrome for the authenticated dashboard. Auth pages live in the (auth) group
 * and deliberately don't get any of this.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const authConfig = getAuthConfig();

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
        ) : (
          <>
            <strong>Research only</strong> — these are real businesses and real contact details, from published
            open data. Nothing here contacts anyone: outreach is disabled in code, not by policy.
          </>
        )}
        {!authConfig.enabled && " No login is configured on this deployment."}
      </div>
      <div className="layout">
        <Sidebar userEmail={user?.email ?? null} />
        <main className="content">{children}</main>
      </div>
      {/* Available on every dashboard page — the Manager is the primary interface,
          not a page you have to navigate to. */}
      <ManagerAssistant demoMode={isDemoMode} />
    </>
  );
}
