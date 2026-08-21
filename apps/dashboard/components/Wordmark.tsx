/**
 * Brand mark. The glyph is a simple funnel — narrowing from a wide scan to a
 * qualified few — drawn inline so it needs no asset request and inherits
 * currentColor in every context it's used.
 */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="wordmark">
      <svg className="wordmark-glyph" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M2 3.5h16L12 11v5.5L8 18v-7L2 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      {!compact && (
        <span className="wordmark-text">
          Market<span className="wordmark-accent">Outreach</span>
        </span>
      )}
    </span>
  );
}
