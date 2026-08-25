/**
 * Download-what-you-see link for the Leads and High-Priority tables.
 *
 * A plain anchor rather than next/link on purpose: this navigates to a
 * file download, and the client router would try to treat the response as a
 * page. The href carries the current filters verbatim, so the file matches the
 * table it sits above.
 */
export function ExportCsvLink({
  params,
  view,
  label = "Download CSV",
  count,
}: {
  params: Record<string, string | undefined>;
  view?: "high-priority";
  label?: string;
  /** Shown in the button so it is obvious how many rows are about to download. */
  count?: number;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  if (view) query.set("view", view);
  const href = `/api/export/leads.csv${query.size ? `?${query.toString()}` : ""}`;

  return (
    <a className="btn btn-secondary" href={href} style={{ display: "inline-flex", alignItems: "center" }}>
      {label}
      {count !== undefined ? ` (${count})` : ""}
    </a>
  );
}
