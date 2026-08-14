import { isDemoMode } from "../lib/demo";

/**
 * Renders a server-action button, or a disabled stand-in on the public
 * read-only demo deploy — so visitors see why controls don't do anything
 * instead of clicking into a silent no-op.
 */
export function ActionButton({ action, label }: { action: () => Promise<void>; label: string }) {
  if (isDemoMode) {
    return (
      <button className="btn-ghost" type="button" disabled title="Disabled in the public read-only demo">
        {label}
      </button>
    );
  }
  return (
    <form action={action}>
      <button className="btn-ghost" type="submit">{label}</button>
    </form>
  );
}
