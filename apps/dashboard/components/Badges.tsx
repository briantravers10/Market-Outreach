const KNOWN_ACRONYMS = new Set(["crm", "sms"]);

function labelize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => (KNOWN_ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{labelize(status)}</span>;
}

export function ConfidenceBadge({ level }: { level: "HIGH" | "MEDIUM" | "LOW" }) {
  return <span className={`badge badge-${level.toLowerCase()}`}>{labelize(level)}</span>;
}

export function QualificationBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{labelize(status)}</span>;
}

export function ScorePill({ score }: { score: number | null }) {
  if (score === null) return <span className="muted">—</span>;
  let color = "#94a3b8";
  let bg = "rgba(148,163,184,0.15)";
  if (score >= 80) { color = "#86efac"; bg = "rgba(34,197,94,0.15)"; }
  else if (score >= 60) { color = "#7dd3fc"; bg = "rgba(56,189,248,0.15)"; }
  else if (score <= 20) { color = "#fca5a5"; bg = "rgba(239,68,68,0.15)"; }
  return (
    <span className="score-pill" style={{ color, background: bg }}>
      {score}
    </span>
  );
}

export { labelize };
