import type { Metadata } from "next";
import { Sidebar } from "../components/Sidebar";
import { isDemoMode } from "../lib/demo";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prospecting System (Skeleton)",
  description: "Internal AI prospecting system — architecture skeleton, fake data only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="safety-banner">
          SKELETON PHASE — all businesses, contacts, and research on this page are synthetic test data.
          No live discovery, no scraping, and no outreach (email/SMS) occurs anywhere in this system.
          {isDemoMode && " This is a public READ-ONLY demo — campaign/job controls are disabled and always show the same seeded snapshot."}
        </div>
        <div className="layout">
          <Sidebar />
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
