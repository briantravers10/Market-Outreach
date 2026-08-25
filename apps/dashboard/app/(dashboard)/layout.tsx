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
      <div className="safety-banner">
        <strong>Skeleton phase</strong> — every business, contact, and piece of research here is synthetic test
        data. No live discovery, no scraping, and no outreach of any kind.
        {isDemoMode && " Public read-only demo: controls are disabled and the snapshot never changes."}
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
