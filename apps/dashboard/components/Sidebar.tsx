"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
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
 * These used to be the literal strings "Dry run" and "Off" under a heading
 * reading "Not live". The CRM had been switched live weeks earlier and the
 * navigation still called it a preview, so a bulk push that writes to a real
 * Pipedrive account looked like a rehearsal.
 */
export interface IntegrationTags {
  crm: { live: boolean; tag: string; explanation: string };
  outreachTag: string;
  outreachLive: boolean;
}

/**
 * A column on a laptop, a header with a menu button on a phone.
 *
 * The previous attempt turned the column into a horizontally-scrolling strip,
 * which was the wrong shape twice over: it inherited `height: 100vh` and became
 * a nav bar as tall as the whole screen, and even once that was fixed, ten
 * destinations in a sideways-scrolling row is a menu you have to swipe through
 * to read. A phone wants a header that stays put and a menu that opens, gets
 * used once, and gets out of the way.
 */
export function Sidebar({ userEmail, integrations }: { userEmail: string | null; integrations: IntegrationTags }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navId = useId();
  const isActive = (href: string) => pathname === href || pathname?.startsWith(`${href}/`);

  /**
   * Close after navigating.
   *
   * A menu that stays open over the page you just asked for is worse than no
   * menu. Keyed on the path so it also closes when a link is followed by any
   * other means — the browser's back button, a redirect after a form post.
   */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes it, which is what every other overlay on the web does.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Tapping the current page changes no path, so the effect above would not
  // fire and the menu would sit there open. Closing on click covers both.
  const close = () => setOpen(false);

  return (
    <nav className="sidebar" data-open={open ? "true" : "false"}>
      <div className="sidebar-brand">
        <Wordmark />
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={open}
          aria-controls={navId}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="nav-toggle-bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="nav-toggle-text">{open ? "Close" : "Menu"}</span>
        </button>
      </div>

      <div className="sidebar-panel" id={navId}>
        <div className="sidebar-section">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={close}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`sidebar-link ${isActive(link.href) ? "active" : ""}`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-heading">Sends things</div>
          <Link
            href="/crm"
            onClick={close}
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
            onClick={close}
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
      </div>
    </nav>
  );
}
