"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/manager", label: "Overview" },
  { href: "/manager/employees", label: "Employees" },
  { href: "/manager/activity", label: "Activity" },
  { href: "/manager/instructions", label: "Instructions" },
  { href: "/manager/reports", label: "Reports" },
  { href: "/manager/scheduled", label: "Scheduled" },
  { href: "/manager/memory", label: "Memory" },
];

export function ManagerTabs() {
  const pathname = usePathname();
  return (
    <div className="filter-bar" style={{ gap: 6, marginBottom: 18 }}>
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`btn ${active ? "btn-primary" : "btn-ghost"}`}
            style={{ textDecoration: "none" }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
