import "server-only";

/**
 * True on the public read-only Vercel demo deploy (DEMO_READ_ONLY=1 project env var).
 * Vercel's serverless functions have no persistent writable disk, so that deployment
 * serves a committed, pre-seeded snapshot (data/demo.db) and disables mutations
 * instead of silently failing or losing state between requests.
 */
export const isDemoMode = process.env.DEMO_READ_ONLY === "1";
