import "server-only";

/**
 * True on the public read-only Vercel demo deploy (DEMO_READ_ONLY=1 project env var).
 * Vercel's serverless functions have no persistent writable disk, so that deployment
 * serves a committed, pre-seeded snapshot (data/demo.db) and disables mutations
 * instead of silently failing or losing state between requests.
 *
 * DATABASE_URL cancels it. Demo mode exists because the SQLite snapshot cannot be
 * written to; with Postgres attached that reason is gone, and leaving demo mode on
 * would turn every control in the dashboard into a silent no-op — buttons that look
 * live, do nothing, and report no error. Whichever variable was left behind, the
 * presence of a real database is the more specific fact, so it wins.
 *
 * This does NOT relax the CRM safety switches: pipedriveAdapter.ts reads
 * DEMO_READ_ONLY directly, and live sync still needs both a token and
 * PIPEDRIVE_LIVE_SYNC=1.
 */
export const isDemoMode =
  process.env.DEMO_READ_ONLY === "1" && !(process.env.DATABASE_URL ?? "").trim();
