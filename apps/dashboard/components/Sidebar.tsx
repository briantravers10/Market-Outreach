"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./Wordmark";

const LINKS = [
  { href: "/manager", label: "Manager" },
  { href: "/overview", label: "Overview" },
  { href: "/team", label: "Team" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/leads", label: "Leads" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/import", label: "Import" },
  { href: "/analytics", label: "Analytics" },
  { href: "/spend", label: "Spend" },
  { href: "/settings", label: "Settings" },
];

/**
 * Destinations whose tag depends on what is actually configured.
 *
 * These tags used to be the literal strings "Dry run" and "Off", under a
 * heading reading "Not live". The CRM had been switched live weeks earlier and
 * the navigation still called it a preview — so a bulk push that writes to a
 * real Pipedrive account looked like a rehearsal. A label that asserts a state
 * rather than reading it is a lie waiting for the state to change, and this
 * one was already false.
 */
export interface IntegrationTags {
  crm: { live: boolean; tag: string; explanation: string };
  outreachTag: string;
  outreachLive: boolean;
}

export function Sidebar({ userEmail, integrations }: { userEmail: string | null; integrations: IntegrationTags }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <Wordmark />
      </div>

      <div className="sidebar-section">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className={`sidebar-link ${isActive(link.href) ? "active" : ""}`}>
            {link.label}
          </Link>
        ))}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-heading">Sends things</div>
        <Link
          href="/crm"
          title={integrations.crm.explanation}
          className={`sidebar-link ${integrations.crm.live ? "" : "sidebar-link-muted"} ${isActive("/crm") ? "active" : ""}`}
        >
          CRM
          <span className={`sidebar-tag ${integrations.crm.live ? "sidebar-tag-live" : ""}`}>
            {integrations.crm.tag}
          </span>
        </Link>
        <Link
          href="/outreach"
          className={`sidebar-link ${integrations.outreachLive ? "" : "sidebar-link-muted"} ${isActive("/outreach") ? "active" : ""}`}
        >
          Outreach
          <span className={`sidebar-tag ${integrations.outreachLive ? "sidebar-tag-live" : ""}`}>
            {integrations.outreachTag}
          </span>
        </Link>
      </div>

      {userEmail && (
        <div className="sidebar-foot">
          <div className="sidebar-user" title={userEmail}>{userEmail}</div>
          <form action="/api/logout" method="post">
            <button type="submit" className="sidebar-signout">Sign out</button>
          </form>
        </div>
      )}
    </nav>
  );
}
