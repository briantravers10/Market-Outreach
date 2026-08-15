import { isDemoMode } from "../lib/demo";

/**
 * Reusable natural-language instruction box — used as the Manager Command
 * Box on Campaigns, and as the direct-instruction box on each agent's page.
 */
export function CommandBox({
  action,
  placeholder,
  buttonLabel = "Assign Task",
}: {
  action: (formData: FormData) => void | Promise<void>;
  placeholder: string;
  buttonLabel?: string;
}) {
  if (isDemoMode) {
    return (
      <div className="command-box">
        <textarea placeholder={placeholder} disabled />
        <button className="btn" type="button" disabled title="Disabled in the public read-only demo">
          {buttonLabel}
        </button>
      </div>
    );
  }
  return (
    <form action={action} className="command-box">
      <textarea name="command" placeholder={placeholder} required />
      <button className="btn" type="submit">
        {buttonLabel}
      </button>
    </form>
  );
}
