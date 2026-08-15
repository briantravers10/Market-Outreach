import type { CountBreakdown } from "@market-outreach/core";

export function BreakdownBars({ items }: { items: CountBreakdown[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (items.length === 0) return <p className="empty-state">No data yet.</p>;
  return (
    <div>
      {items.map((item) => (
        <div className="breakdown-row" key={item.key}>
          <span className="breakdown-label" title={item.key}>{item.key}</span>
          <span className="breakdown-bar-track">
            <span className="breakdown-bar-fill" style={{ width: `${(item.count / max) * 100}%` }} />
          </span>
          <span className="breakdown-count">{item.count}</span>
        </div>
      ))}
    </div>
  );
}
