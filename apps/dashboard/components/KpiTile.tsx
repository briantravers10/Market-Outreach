export function KpiTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="kpi-tile">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}
