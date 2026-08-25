import Link from "next/link";
import { ManagerTabs } from "../../../components/manager/ManagerTabs";

/**
 * Chrome for the Manager area. The tab strip is a client component only because
 * it needs the current path to mark the active tab; everything below it stays a
 * server component.
 */
export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="page-header">
        <h1>Manager</h1>
        <p>
          Your AI Manager coordinates the team, records your instructions, and keeps the company&apos;s
          history. Talk to it any time using the button in the bottom-right.
        </p>
      </div>
      <ManagerTabs />
      {children}
    </div>
  );
}
