"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/overview", label: "Overview" },
  { href: "/queue", label: "Work Queue" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/leads", label: "Leads" },
  { href: "/high-priority", label: "High Priority" },
  { href: "/reports", label: "Reports" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        Prospecting System
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
    </nav>
  );
}
