"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./Wordmark";

const LINKS = [
  { href: "/overview", label: "Overview" },
  { href: "/team", label: "Team" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/leads", label: "Leads" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Settings" },
];

// Not-yet-live destinations. CRM is built but runs in dry-run until an account
// is connected, so it gets a different tag than the genuinely unbuilt Outreach.
const PENDING_LINKS = [
  { href: "/crm", label: "CRM", tag: "Dry run" },
  { href: "/outreach", label: "Outreach", tag: "Off" },
];

export function Sidebar({ userEmail }: { userEmail: string | null }) {
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
        <div className="sidebar-heading">Not live</div>
        {PENDING_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`sidebar-link sidebar-link-muted ${isActive(link.href) ? "active" : ""}`}
          >
            {link.label}
            <span className="sidebar-tag">{link.tag}</span>
          </Link>
        ))}
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
