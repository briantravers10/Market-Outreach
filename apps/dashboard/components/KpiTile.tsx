/**
 * A headline figure.
 *
 * `note` carries the denominator behind a ratio — "per qualified lead" means
 * nothing without knowing how many that was, and a figure whose basis is
 * hidden invites the reader to assume the flattering one.
 */
export function KpiTile({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="kpi-tile">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}
