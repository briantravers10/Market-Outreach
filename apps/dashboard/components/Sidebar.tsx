"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
  { href: "/outreach", label: "Outreach", tag: "Disabled" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        Prospecting Team
        <small>Skeleton phase · fake data only</small>
      </div>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`sidebar-link ${pathname?.startsWith(link.href) ? "active" : ""}`}
        >
          {link.label}
        </Link>
      ))}
      <div className="sidebar-divider" />
      {PENDING_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`sidebar-link sidebar-link-disabled ${pathname?.startsWith(link.href) ? "active" : ""}`}
        >
          {link.label}
          <span className="sidebar-disabled-tag">{link.tag}</span>
        </Link>
      ))}
    </nav>
  );
}
