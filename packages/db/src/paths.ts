import fs from "node:fs";
import path from "node:path";

/** Same find-up strategy as packages/core/src/config.ts — see that file for why. */
export function findRepoRoot(): string {
  const candidates = [__dirname, process.cwd()];
  for (const start of candidates) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, "config", "territories.json"))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    `Could not locate repo root starting from __dirname=${__dirname} or cwd=${process.cwd()}`
  );
}

/**
 * Public Vercel deployments of this skeleton run against a committed, pre-seeded,
 * read-only snapshot (data/demo.db) instead of the local read-write dev database —
 * Vercel's serverless functions don't have persistent writable disk. Set via the
 * DEMO_READ_ONLY=1 project env var; see packages/db/src/client.ts.
 */
export function isDemoReadOnly(): boolean {
  return process.env.DEMO_READ_ONLY === "1";
}

export function defaultDbPath(): string {
  const root = findRepoRoot();

  if (isDemoReadOnly()) {
    return path.join(root, "data", "demo.db");
  }

  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "prospecting.db");
}
